const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
require("dotenv").config({ quiet: true });

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (!url.pathname.endsWith("_test")) url.pathname += "_test";
  if (!/^[A-Za-z0-9_]+_test$/.test(url.pathname.slice(1))) throw new Error("Test database required.");
  const environment = { ...process.env, DATABASE_URL: url.toString(),
    TEST_DATABASE_URL: url.toString(), NODE_ENV: "test" };
  run(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], environment);
  const port = await availablePort(), runId = randomUUID().replaceAll("-", "");
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(), env: { ...environment, PORT: String(port) }, stdio: "inherit"
  });
  const { PrismaClient } = require("@prisma/client");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const testDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    await waitForHealth(base, server);
    const args = ["test", "test/plans/fitai_21_fresh_device_plan_e2e_test.dart",
      `--dart-define=FITAI_21_BASE_URL=${base}`, `--dart-define=FITAI_21_RUN_ID=${runId}`];
    const result = process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["flutter", ...args].join(" ")],
        { cwd: path.resolve("..", "app"), env: environment, stdio: "inherit" })
      : spawnSync("flutter", args, { cwd: path.resolve("..", "app"), env: environment, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`FITAI-21 plan E2E failed (exit ${result.status}).`);
  } finally {
    await testDb.user.deleteMany({ where: { email: { in: [
      `fitai21-plan-${runId}@fitia.test`, `fitai21-other-${runId}@fitia.test`,
      `fitai21-integrated-${runId}@fitia.test`
    ] } } });
    await testDb.$disconnect();
    await new Promise(resolve => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", resolve); server.kill();
      setTimeout(resolve, 3000).unref();
    });
  }
}
function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("PostgreSQL migration gate failed.");
}
function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer(); listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const port = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitForHealth(base, server) {
  const until = Date.now() + 15000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error("Test server stopped.");
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Retry readiness only. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Test server readiness timeout.");
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
