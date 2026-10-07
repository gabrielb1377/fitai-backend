const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../../src/app");
const { CONTRACT_VERSION } = require("../../src/modules/activity_sync/activity_sync.rules");

test("ACT-RUN-01: push e pull exigem JWT", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const push = await fetch(`${base}/activities/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        deviceId: "http-test",
        afterRevision: "0",
        runs: [{}],
        steps: []
      })
    });
    const pull = await fetch(`${base}/activities/sync`);
    assert.equal(push.status, 401);
    assert.equal(pull.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
