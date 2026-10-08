const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../../src/app");
const { CONTRACT_VERSION, RULES_VERSION } = require("../../src/modules/progression/progression.sync.rules");

test("XP-REMOTE-01/SECURITY: push e pull exigem JWT valido", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const missing = await fetch(`${baseUrl}/progression/sync/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload())
    });
    const invalid = await fetch(`${baseUrl}/progression/sync`, {
      headers: { Authorization: "Bearer invalid-token" }
    });

    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error, "missing_token");
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error, "invalid_token");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function payload() {
  return {
    contractVersion: CONTRACT_VERSION,
    rulesVersion: RULES_VERSION,
    deviceId: "http-test",
    afterRevision: "0",
    events: [{
      eventId: "event-1",
      sourceType: "workout",
      sourceId: "workout-1",
      occurredAt: "2026-10-04T10:00:00.000Z",
      rulesVersion: RULES_VERSION
    }]
  };
}
