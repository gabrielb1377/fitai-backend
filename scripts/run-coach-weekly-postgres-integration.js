const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
require("dotenv").config();

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (!process.env.TEST_DATABASE_URL) url.pathname += "_test";
  const name = url.pathname.slice(1);
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error("Somente banco com sufixo _test e permitido.");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount) {
      await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }
  const env = { ...process.env, DATABASE_URL: url.toString(), TEST_DATABASE_URL: url.toString(),
    NODE_ENV: "test", RUN_COACH_WEEKLY_POSTGRES_TESTS: "1",
    AI_PROVIDER: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "" };
  const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
    cwd: process.cwd(), env, stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Migrations no banco de teste falharam (${result.status}).`);
  const testResult = spawnSync(process.execPath, ["--test", "tests/ai/weekly.summary.postgres.integration.test.js"], {
    cwd: process.cwd(), env, stdio: "inherit"
  });
  if (testResult.error) throw testResult.error;
  if (testResult.status !== 0) throw new Error(`Gate PostgreSQL Coach V1.3 falhou (${testResult.status}).`);
}
main().catch(() => {
  console.error("[coach-weekly:test] Falha no gate PostgreSQL do Coach IA V1.3; credenciais nao sao exibidas.");
  process.exitCode = 1;
});
