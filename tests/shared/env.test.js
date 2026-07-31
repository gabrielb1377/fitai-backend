const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnv, minimumJwtSecretLength } = require("../../src/config/env");

const valid = {
  NODE_ENV: "production",
  PORT: "3001",
  DATABASE_URL: "postgresql://user:password@localhost:5432/fitai_test?schema=public",
  JWT_SECRET: "a".repeat(minimumJwtSecretLength)
};

test("configuracao exige database URL e JWT em todos os ambientes", () => {
  assert.throws(
    () => createEnv({ ...valid, DATABASE_URL: "" }),
    /DATABASE_URL/
  );
  assert.throws(() => createEnv({ ...valid, JWT_SECRET: "" }), /JWT_SECRET/);
});

test("configuracao rejeita JWT curto ou previsivel", () => {
  assert.throws(
    () => createEnv({ ...valid, JWT_SECRET: "curto" }),
    /pelo menos/
  );
  assert.throws(
    () => createEnv({ ...valid, JWT_SECRET: "local-development-secret-1234567890" }),
    /previsivel/
  );
});

test("configuracao aceita somente URL PostgreSQL valida", () => {
  const env = createEnv(valid);
  assert.equal(env.nodeEnv, "production");
  assert.equal(env.port, 3001);
  assert.throws(
    () => createEnv({ ...valid, DATABASE_URL: "https://fitia.dev" }),
    /postgresql/
  );
});
