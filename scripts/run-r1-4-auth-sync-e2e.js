const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

require("dotenv").config();

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || deriveTestDatabaseUrl(process.env.DATABASE_URL);
  await ensureTestDatabase(testDatabaseUrl);

  const environment = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test"
  };
  run(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], environment);

  const runId = randomUUID().replaceAll("-", "");
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...environment, PORT: String(port) },
    stdio: "inherit"
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });

  try {
    await waitForHealth(baseUrl, server);
    runFlutter(baseUrl, runId, environment);
    await verifyDatabase(prisma, runId);
    console.info("[r1.4:e2e] Flutter -> HTTP -> JWT -> Prisma -> PostgreSQL validado.");
  } finally {
    await cleanupUsers(prisma, runId);
    await prisma.$disconnect();
    await stopServer(server);
  }
}

function deriveTestDatabaseUrl(databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL ou TEST_DATABASE_URL deve ser definido.");
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");
  if (!databaseName) throw new Error("DATABASE_URL nao possui nome de banco.");
  url.pathname = `/${databaseName}_test`;
  return url.toString();
}

async function ensureTestDatabase(testDatabaseUrl) {
  const testUrl = new URL(testDatabaseUrl);
  const databaseName = testUrl.pathname.replace(/^\//, "");
  if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL deve apontar para um banco com sufixo _test.");
  }

  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = "/postgres";
  const { Client } = require("pg");
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      console.info(`[r1.4:e2e] banco criado: ${databaseName}`);
    }
  } finally {
    await admin.end();
  }
}

function runFlutter(baseUrl, runId, environment) {
  const args = [
    "test",
    "test/workout_vertical_slice/r1_4_auth_sync_e2e_test.dart",
    `--dart-define=VS2_LIVE_BASE_URL=${baseUrl}`,
    `--dart-define=R1_4_RUN_ID=${runId}`
  ];
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["flutter", ...args].join(" ")], {
      cwd: resolveAppDirectory(),
      env: environment,
      stdio: "inherit"
    })
    : spawnSync("flutter", args, {
      cwd: resolveAppDirectory(),
      env: environment,
      stdio: "inherit"
    });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Flutter E2E terminou com codigo ${result.status || 1}.`);
  }
}

function resolveAppDirectory() {
  const path = require("node:path");
  return path.resolve(process.cwd(), "..", "app");
}

async function verifyDatabase(prisma, runId) {
  const emailA = `r14-a-${runId}@fitia.test`;
  const emailB = `r14-b-${runId}@fitia.test`;
  const [userA, userB] = await Promise.all([
    prisma.user.findUnique({ where: { email: emailA }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: emailB }, select: { id: true } })
  ]);
  assert.ok(userA, "USER_A deve existir no PostgreSQL de teste.");
  assert.ok(userB, "USER_B deve existir no PostgreSQL de teste.");

  const [sessionsA, setsA, eventsA, sessionsB, setsB, eventsB, tamperedEvent] = await Promise.all([
    prisma.workoutSyncSession.count({ where: { userId: userA.id } }),
    prisma.workoutSyncSet.count({ where: { userId: userA.id } }),
    prisma.workoutSyncEvent.count({ where: { userId: userA.id } }),
    prisma.workoutSyncSession.count({ where: { userId: userB.id } }),
    prisma.workoutSyncSet.count({ where: { userId: userB.id } }),
    prisma.workoutSyncEvent.findMany({
      where: { userId: userB.id },
      select: { status: true, deviceId: true }
    }),
    prisma.workoutSyncEvent.findFirst({
      where: { userId: userA.id, deviceId: `tampered-client-${runId}` },
      select: { id: true }
    })
  ]);

  assert.equal(sessionsA, 2, "USER_A deve possuir duas sessoes aceitas no recorte E2E.");
  assert.equal(setsA, 2, "Retry e idempotencia devem resultar em duas series logicas de USER_A.");
  assert.equal(eventsA, 5, "ACK duplicado nao deve inserir evento adicional para USER_A.");
  assert.equal(sessionsB, 0, "USER_B nao pode criar sessao usando a sessao de USER_A.");
  assert.equal(setsB, 0, "USER_B nao pode gravar serie na sessao de USER_A.");
  assert.deepEqual(
    eventsB.map((event) => event.status),
    [],
    "Conflito de ownership e retornado antes de qualquer persistencia de USER_B."
  );
  assert.ok(tamperedEvent, "clientId adulterado deve registrar evento de USER_A, nunca trocar owner.");
}

async function cleanupUsers(prisma, runId) {
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [`r14-a-${runId}@fitia.test`, `r14-b-${runId}@fitia.test`]
      }
    }
  });
}

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} terminou com codigo ${result.status || 1}.`);
  }
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => {
        if (error) return reject(error);
        resolve(address.port);
      });
    });
  });
}

async function waitForHealth(baseUrl, server) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Servidor de teste encerrou antes do health check.");
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch (_) {
      // O processo ainda pode estar aplicando a inicializacao do Prisma.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Servidor de teste nao respondeu ao health check em 15 segundos.");
}

function stopServer(server) {
  if (server.exitCode !== null || server.killed) return Promise.resolve();
  return new Promise((resolve) => {
    server.once("exit", resolve);
    server.kill();
    setTimeout(resolve, 3000).unref();
  });
}

main().catch((error) => {
  console.error(`[r1.4:e2e] ${error.message}`);
  process.exitCode = 1;
});
