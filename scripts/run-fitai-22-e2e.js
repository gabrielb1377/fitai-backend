const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
require("dotenv").config({ quiet: true });

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (!url.pathname.endsWith("_test")) url.pathname += "_test";
  if (!/^[A-Za-z0-9_]+_test$/.test(url.pathname.slice(1))) {
    throw new Error("FITAI-22 requires a PostgreSQL test database.");
  }
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    TEST_DATABASE_URL: url.toString(),
    NODE_ENV: "test",
  };
  run(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], env);

  const runId = randomUUID().replaceAll("-", "");
  const planId = `fitai22-plan-${runId}`;
  const addExerciseId = "ombros_004";
  const action = {
    type: "ADD_EXERCISE_TO_PLAN",
    planId,
    dayOrder: 1,
    canonicalExerciseId: addExerciseId,
    sets: 3,
    repetitions: "10",
    restSeconds: 60,
    reason: "Variar o estimulo com um exercicio do catalogo.",
  };
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["scripts/fitai-22-test-server.js"], {
    cwd: process.cwd(),
    env: { ...env, PORT: String(port), FITAI_22_ACTION_JSON: JSON.stringify(action) },
    stdio: "inherit",
  });
  const { PrismaClient } = require("@prisma/client");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    await waitForHealth(base, server);
    const args = [
      "test",
      "test/fitai_22/fitai_22_integrated_e2e_test.dart",
      `--dart-define=FITAI_22_BASE_URL=${base}`,
      `--dart-define=FITAI_22_RUN_ID=${runId}`,
      `--dart-define=FITAI_22_PLAN_ID=${planId}`,
      `--dart-define=FITAI_22_ADD_EXERCISE_ID=${addExerciseId}`,
    ];
    const result = process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["flutter", ...args].join(" ")],
        { cwd: path.resolve("..", "app"), env, stdio: "inherit" })
      : spawnSync("flutter", args, { cwd: path.resolve("..", "app"), env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`FITAI-22 integration failed (exit ${result.status}).`);
  } finally {
    await db.user.deleteMany({ where: { email: { contains: runId } } });
    await db.$disconnect();
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", resolve);
      server.kill();
      setTimeout(resolve, 3000).unref();
    });
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("FITAI-22 PostgreSQL migration gate failed.");
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(base, server) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error("FITAI-22 test server stopped.");
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch { /* Retry only server readiness. */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("FITAI-22 test server readiness timeout.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
