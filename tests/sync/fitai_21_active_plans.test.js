const test = require("node:test");
const assert = require("node:assert/strict");
const { getWorkouts } = require("../../src/modules/sync/sync.service");

function fixture(rows = []) {
  const calls = [];
  const db = {
    user: { findUnique: async () => ({ id: "owner-a" }) },
    workout: { findMany: async args => { calls.push(args); return rows; } }
  };
  return { db, calls };
}
test("S21 active plans: opt-in page is bounded, ordered and JWT-owned", async () => {
  const { db, calls } = fixture(Array.from({length: 51}, (_, i) => ({id: `plan-${i}`})));
  const result = await getWorkouts({auth: {userId: "owner-a"}}, {paged: "1", afterId: "before"}, db);
  assert.equal(result.workouts.length, 50);
  assert.equal(result.afterId, "plan-49");
  assert.equal(result.hasMore, true);
  assert.deepEqual(calls[0].where, {userId: "owner-a", deletedAt: null, id: {gt: "before"}});
  assert.equal(calls[0].take, 51);
  assert.deepEqual(calls[0].orderBy, {id: "asc"});
});
test("S21 active plans: completed scan resets cursor for subsequent edits", async () => {
  const {db} = fixture([{id: "last"}]);
  const result = await getWorkouts({auth: {userId: "owner-a"}}, {paged: "1"}, db);
  assert.equal(result.afterId, "");
  assert.equal(result.hasMore, false);
});
test("S21 active plans: unpaged legacy response remains compatible", async () => {
  const {db, calls} = fixture([{id: "legacy"}]);
  const result = await getWorkouts({auth: {userId: "owner-a"}}, {}, db);
  assert.deepEqual(result, {workouts: [{id: "legacy"}]});
  assert.equal(calls[0].take, undefined);
  assert.deepEqual(calls[0].orderBy, {updatedAt: "desc"});
});
test("S21 active plans: malformed cursor rejected before read", async () => {
  const {db, calls} = fixture();
  await assert.rejects(getWorkouts({auth: {userId: "owner-a"}}, {paged: "1", afterId: ["bad"]}, db),
    error => error.code === "invalid_sync_cursor");
  assert.equal(calls.length, 0);
});
