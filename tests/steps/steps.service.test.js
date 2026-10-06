const test = require("node:test");
const assert = require("node:assert/strict");
const {
  syncSteps,
  reconcileStepRecord,
  buildStepStats,
  normalizeDateKey
} = require("../../src/modules/steps/steps.service");

test("legacy steps sync cannot overwrite a day already owned by ActivitySync/v2", async () => {
  const user = { id: "user-a", name: "A", email: "a@test.dev" };
  const canonical = {
    id: "steps-a",
    userId: user.id,
    date: new Date("2026-10-05T00:00:00.000Z"),
    steps: 5900,
    goal: 10000,
    source: "health_connect",
    createdAt: new Date("2026-10-05T12:00:00.000Z"),
    updatedAt: new Date("2026-10-05T12:00:00.000Z")
  };
  let writes = 0;
  const db = {
    user: { findUnique: async () => user },
    dailySteps: {
      findUnique: async () => canonical,
      upsert: async () => {
        writes++;
        return canonical;
      }
    },
    activitySyncMutation: { findFirst: async () => ({ revision: 9n }) }
  };

  const result = await syncSteps(
    { auth: { userId: user.id } },
    { clientId: "old-device" },
    [{ date: "2026-10-05", steps: 6200, source: "health_connect" }],
    db
  );

  assert.equal(result.steps[0].steps, 5900);
  assert.equal(writes, 0);
});

test("legacy steps sync remains writable before a v2 identity exists", async () => {
  const user = { id: "user-a", name: "A", email: "a@test.dev" };
  let writes = 0;
  const db = {
    user: { findUnique: async () => user },
    dailySteps: {
      findUnique: async () => null,
      upsert: async ({ create }) => {
        writes++;
        return {
          id: "legacy-steps",
          ...create,
          createdAt: new Date("2026-10-05T12:00:00.000Z"),
          updatedAt: new Date("2026-10-05T12:00:00.000Z")
        };
      }
    },
    activitySyncMutation: { findFirst: async () => null }
  };

  const result = await syncSteps(
    { auth: { userId: user.id } },
    { clientId: "old-device" },
    [{ date: "2026-10-05", steps: 6200, source: "local" }],
    db
  );

  assert.equal(result.steps[0].steps, 6200);
  assert.equal(writes, 1);
});

test("reconcileStepRecord keeps the largest value for the same day", () => {
  const existing = {
    steps: 8000,
    goal: 10000,
    source: "health_connect"
  };
  const incoming = {
    steps: 7200,
    goal: 9000,
    source: "local"
  };

  const merged = reconcileStepRecord(existing, incoming);

  assert.equal(merged.steps, 8000);
  assert.equal(merged.goal, 9000);
  assert.equal(merged.source, "health_connect");
});

test("reconcileStepRecord accepts a higher Health Connect total", () => {
  const existing = {
    steps: 6000,
    goal: 10000,
    source: "local"
  };
  const incoming = {
    steps: 9300,
    goal: 10000,
    source: "health_connect"
  };

  const merged = reconcileStepRecord(existing, incoming);

  assert.equal(merged.steps, 9300);
  assert.equal(merged.source, "health_connect");
});

test("buildStepStats calculates totals, averages, best day and streak", () => {
  const records = [
    {
      date: new Date("2026-07-08T00:00:00.000Z"),
      steps: 7000,
      goal: 8000,
      source: "local"
    },
    {
      date: new Date("2026-07-09T00:00:00.000Z"),
      steps: 9000,
      goal: 8000,
      source: "health_connect"
    },
    {
      date: new Date("2026-07-10T00:00:00.000Z"),
      steps: 8200,
      goal: 8000,
      source: "health_connect"
    }
  ];

  const stats = buildStepStats(records, {
    today: new Date("2026-07-10T12:00:00.000Z")
  });

  assert.equal(stats.totalSteps, 24200);
  assert.equal(stats.averageSteps, 8067);
  assert.equal(stats.bestDay.steps, 9000);
  assert.equal(stats.goalCompletedDays, 2);
  assert.equal(stats.activeStreak, 2);
});

test("normalizeDateKey accepts ISO date-time and simple date", () => {
  assert.equal(normalizeDateKey("2026-07-10"), "2026-07-10");
  assert.equal(
    normalizeDateKey("2026-07-10T15:20:00.000Z"),
    "2026-07-10"
  );
});
