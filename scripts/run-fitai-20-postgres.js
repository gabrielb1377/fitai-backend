const { spawnSync } = require("node:child_process");
require("dotenv").config({ quiet: true });
const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
if (!url.pathname.endsWith("_test")) url.pathname += "_test";
if (!/^[A-Za-z0-9_]+_test$/.test(url.pathname.slice(1))) throw new Error("Test database required");
const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(),
  NODE_ENV: "test", RUN_FITAI_20_POSTGRES: "1" };
for (const args of [
  [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
  ["--test", ...process.argv.slice(2), "tests/sync/fitai_20_closure.postgres.integration.test.js"]
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
