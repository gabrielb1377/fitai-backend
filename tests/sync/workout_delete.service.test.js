const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deleteWorkoutById
} = require("../../src/modules/sync/sync.service");

test("deleteWorkoutById aplica tombstone apenas ao plano do usuario e e idempotente", async () => {
  const calls = [];
  let present = true;
  const db = {
    workout: {
      updateMany: async (args) => {
        calls.push(args);
        if (!present) return { count: 0 };
        present = false;
        return { count: 1 };
      }
    }
  };

  const first = await deleteWorkoutById("user-a", "plan-a", db);
  const replay = await deleteWorkoutById("user-a", "plan-a", db);

  assert.equal(first.deleted, true);
  assert.equal(replay.alreadyDeleted, true);
  assert.deepEqual(calls[0].where, {
    id: "plan-a",
    userId: "user-a",
    deletedAt: null
  });
  assert.ok(calls[0].data.deletedAt instanceof Date);
});
