const { spawnSync } = require("node:child_process");
const { Client } = require("pg");

require("dotenv").config();

async function main() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL || deriveTestDatabaseUrl(process.env.DATABASE_URL);
  await ensureTestDatabase(testDatabaseUrl);
  const environment = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    TEST_DATABASE_URL: testDatabaseUrl,
    NODE_ENV: "test",
    RUN_PROGRESSION_SYNC_POSTGRES_TESTS: "1"
  };

  run(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], environment);
  run(process.execPath, ["--test", "tests/progression/progression.sync.postgres.integration.test.js"], environment);
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
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      console.info(`[progression-sync:test] banco criado: ${databaseName}`);
    }
  } finally {
    await admin.end();
  }
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

main().catch((error) => {
  console.error(`[progression-sync:test] ${error.message}`);
  process.exitCode = 1;
});
