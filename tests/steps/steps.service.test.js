const test = require("node:test");
const assert = require("node:assert/strict");
const {
  reconcileStepRecord,
  buildStepStats,
  normalizeDateKey
} = require("../../src/modules/steps/steps.service");

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
