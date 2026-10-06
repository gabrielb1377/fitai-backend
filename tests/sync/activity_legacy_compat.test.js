const test = require("node:test");
const assert = require("node:assert/strict");
const { syncRunning } = require("../../src/modules/sync/sync.service");

test("legacy running sync cannot resurrect a v2 tombstone", async () => {
  const user = { id: "user-a", name: "A", email: "a@test.dev" };
  const tombstone = {
    id: "row-a",
    userId: user.id,
    externalRunId: "run-a",
    deletedAt: new Date("2026-10-05T12:00:00.000Z")
  };
  let writes = 0;
  const db = {
    user: { findUnique: async () => user },
    activitySyncMutation: { findFirst: async () => ({ operation: "tombstone" }) },
    runningHistory: {
      findUnique: async () => tombstone,
      upsert: async () => {
        writes++;
        return tombstone;
      }
    }
  };

  const result = await syncRunning(
    { auth: { userId: user.id } },
    { clientId: "old-device" },
    [{ id: "run-a", data: "2026-10-05T11:00:00.000Z", distancia: 5, segundos: 1800 }],
    db
  );

  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].deletedAt, tombstone.deletedAt);
  assert.equal(writes, 0);
});

test("legacy running sync remains compatible before a v2 marker exists", async () => {
  const user = { id: "user-a", name: "A", email: "a@test.dev" };
  let writes = 0;
  const db = {
    user: { findUnique: async () => user },
    activitySyncMutation: { findFirst: async () => null },
    runningHistory: {
      findUnique: async () => null,
      upsert: async ({ create }) => {
        writes++;
        return create;
      }
    }
  };

  const result = await syncRunning(
    { auth: { userId: user.id } },
    { clientId: "old-device" },
    [{ id: "legacy-run", data: "2026-10-05T11:00:00.000Z", distancia: 5, segundos: 1800 }],
    db
  );

  assert.equal(result.runs[0].externalRunId, "legacy-run");
  assert.equal(writes, 1);
});
