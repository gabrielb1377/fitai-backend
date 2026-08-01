const assert = require("node:assert/strict");
const test = require("node:test");

const { scanContent } = require("../../scripts/check-staged-secrets");

test("permite placeholders seguros em .env.example", () => {
  const findings = scanContent(
    ".env.example",
    "DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/fitai_db\nJWT_SECRET=REPLACE_WITH_A_RANDOM_SECRET"
  );

  assert.deepEqual(findings, []);
});

test("bloqueia arquivo de ambiente e valores sensiveis", () => {
  const fakeJwtName = ["JWT", "SECRET"].join("_");
  const fakeJwtValue = ["val", "ue"].join("");
  const fakeOpenAiKey = ["sk", "123456789012345678901234"].join("-");

  assert.deepEqual(scanContent(".env", `${fakeJwtName}=${fakeJwtValue}`), [
    "arquivo sensivel bloqueado",
    "atribuicao de JWT_SECRET"
  ]);
  assert.deepEqual(
    scanContent("src/config.js", `OPENAI_API_KEY=${fakeOpenAiKey}`),
    ["OpenAI key", "atribuicao de OPENAI_API_KEY"]
  );
});
