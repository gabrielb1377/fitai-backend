const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAuthRateLimit } = require("../../src/shared/middleware/auth-rate-limit.middleware");

test("limita tentativas de autenticacao e preserva headers de rate limit", async (t) => {
  const app = express();
  app.use(express.json());
  app.post("/login", createAuthRateLimit({ windowMs: 60000, limit: 2 }), (req, res) => {
    res.status(401).json({ error: "invalid_credentials" });
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/login`;
  const request = () => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });

  assert.equal((await request()).status, 401);
  assert.equal((await request()).status, 401);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, "too_many_auth_attempts");
  assert.ok(
    limited.headers.get("ratelimit") ||
      limited.headers.get("ratelimit-policy") ||
      limited.headers.get("x-ratelimit-limit")
  );
});
