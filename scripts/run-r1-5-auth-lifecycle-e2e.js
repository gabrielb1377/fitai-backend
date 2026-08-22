const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

require("dotenv").config();

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || deriveTestDatabaseUrl(process.env.DATABASE_URL);
  await ensureTestDatabase(testDatabaseUrl);
  const environment = { ...process.env, DATABASE_URL: testDatabaseUrl, TEST_DATABASE_URL: testDatabaseUrl, NODE_ENV: "test" };
  run(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], environment);
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = randomUUID().replaceAll("-", "");
  const server = spawn(process.execPath, ["src/server.js"], { cwd: process.cwd(), env: { ...environment, PORT: String(port) }, stdio: "inherit" });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  try {
    await waitForHealth(baseUrl, server);
    runFlutter(baseUrl, runId, environment);
    run(process.execPath, ["--test", "tests/auth/auth.lifecycle.postgres.integration.test.js"], { ...environment, R1_5_BASE_URL: baseUrl });
    console.info("[r1.5:e2e] Flutter -> auth -> JWT -> refresh -> PostgreSQL validado.");
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: [`r15-flutter-a-${runId}@fitia.test`, `r15-flutter-b-${runId}@fitia.test`] } } });
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
  if (!/^[A-Za-z0-9_]+_test$/.test(databaseName)) throw new Error("TEST_DATABASE_URL deve apontar para um banco com sufixo _test.");
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = "/postgres";
  const { Client } = require("pg");
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
}

function runFlutter(baseUrl, runId, environment) {
  const args = ["test", "test/auth/r1_5_auth_lifecycle_e2e_test.dart", `--dart-define=R1_5_BASE_URL=${baseUrl}`, `--dart-define=R1_5_RUN_ID=${runId}`];
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["flutter", ...args].join(" ")], { cwd: path.resolve(process.cwd(), "..", "app"), env: environment, stdio: "inherit" })
    : spawnSync("flutter", args, { cwd: path.resolve(process.cwd(), "..", "app"), env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Flutter R1.5 terminou com codigo ${result.status || 1}.`);
}

function run(command, args, environment) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminou com codigo ${result.status || 1}.`);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, server) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Servidor de teste encerrou antes do health check.");
    try { if ((await fetch(`${baseUrl}/health`)).ok) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Servidor de teste nao respondeu em 15 segundos.");
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
  console.error(`[r1.5:e2e] ${error.message}`);
  process.exitCode = 1;
});
