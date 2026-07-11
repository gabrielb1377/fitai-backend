const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../../src/app");

function startTestServer() {
  return new Promise((resolve) => {
    const app = createApp();
    const server = app.listen(0, () => resolve(server));
  });
}

function closeTestServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}

function url(server, path) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}${path}`;
}

test("preflight allows local Flutter Web origins", async (t) => {
  const server = await startTestServer();
  t.after(() => closeTestServer(server));

  const origin = "http://localhost:53842";
  const response = await fetch(url(server, "/ai/generate-workout"), {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type, Authorization, X-FitIA-Client-Id, Idempotency-Key"
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.match(response.headers.get("access-control-allow-methods"), /POST/);
  assert.match(response.headers.get("access-control-allow-methods"), /OPTIONS/);
  assert.match(response.headers.get("access-control-allow-headers"), /Content-Type/);
  assert.match(response.headers.get("access-control-allow-headers"), /Authorization/);
  assert.match(response.headers.get("access-control-allow-headers"), /X-FitIA-Client-Id/);
  assert.match(response.headers.get("access-control-allow-headers"), /Idempotency-Key/);
});

test("health response includes CORS header for 127 local origins", async (t) => {
  const server = await startTestServer();
  t.after(() => closeTestServer(server));

  const origin = "http://127.0.0.1:5173";
  const response = await fetch(url(server, "/health"), {
    headers: {
      Origin: origin
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});
