const test = require("node:test");
const assert = require("node:assert/strict");
const { parseBatch, parseRun, parseSteps } = require("../../src/modules/activity_sync/activity_sync.schemas");
const { CONTRACT_VERSION } = require("../../src/modules/activity_sync/activity_sync.rules");

test("ActivitySync/v2 rejeita spoofed userId e dados Health brutos", () => {
  const spoofed = parseBatch({
    ...batch(),
    userId: "user-b"
  });
  const rawHealth = parseSteps({
    ...steps(),
    samples: [{ value: 10 }]
  });
  assert.equal(spoofed.success, false);
  assert.equal(rawHealth.success, false);
});

test("ActivitySync/v2 valida dayKey, metricas e coordenadas", () => {
  assert.equal(parseSteps({ ...steps(), dayKey: "2026-02-30" }).success, false);
  assert.equal(parseSteps({ ...steps(), steps: -1 }).success, false);
  assert.equal(parseRun({ ...run(), distanceKm: Number.NaN }).success, false);
  assert.equal(parseRun({
    ...run(),
    route: [{ ...run().route[0], latitude: 91 }]
  }).success, false);
  assert.equal(parseRun(run()).success, true);
});

function batch() {
  return {
    contractVersion: CONTRACT_VERSION,
    deviceId: "device-a",
    afterRevision: "0",
    runs: [run()],
    steps: []
  };
}

test("FITAI-12: progress metadata is optional and preserves strict v2 validation", () => {
  const value = run();
  value.route[0] = { ...value.route[0], cumulativeDistanceKm: 0, activeElapsedSeconds: 60, startsSegment: true };
  assert.equal(parseRun(value).success, true);
  for (const change of [
    { cumulativeDistanceKm: -1 },
    { cumulativeDistanceKm: 6 },
    { activeElapsedSeconds: 1801 },
    { activeElapsedSeconds: 1.5 },
    { startsSegment: "yes" },
    { extra: "unknown" }
  ]) {
    assert.equal(parseRun({ ...value, route: [{ ...value.route[0], ...change }] }).success, false);
  }
  assert.equal(parseRun({ ...value, route: [{ ...run().route[0], cumulativeDistanceKm: 0 }] }).success, false);
});

test("FITAI-12: canonical progress cannot decrease or bridge a segment reset", () => {
  const value = run();
  value.route = [
    { ...value.route[0], cumulativeDistanceKm: 1, activeElapsedSeconds: 300 },
    { ...value.route[0], timestamp: "2026-10-05T10:10:00Z", cumulativeDistanceKm: 2, activeElapsedSeconds: 600 }
  ];
  assert.equal(parseRun(value).success, true);
  for (const change of [
    { cumulativeDistanceKm: 0.5 },
    { activeElapsedSeconds: 200 },
    { timestamp: value.route[0].timestamp },
    { startsSegment: true }
  ]) {
    assert.equal(parseRun({ ...value, route: [value.route[0], { ...value.route[1], ...change }] }).success, false);
  }
});

function run() {
  return {
    mutationId: "run:r1:v1",
    runId: "r1",
    startedAt: "2026-10-05T10:00:00.000Z",
    finishedAt: "2026-10-05T10:30:00.000Z",
    durationSeconds: 1800,
    distanceKm: 5,
    averageSpeed: 10,
    paceMinutesPerKm: 6,
    route: [{
      latitude: -12.9714,
      longitude: -38.5014,
      accuracy: 5,
      altitude: 10,
      speed: 2.8,
      timestamp: "2026-10-05T10:01:00.000Z"
    }],
    calories: null,
    steps: null,
    deletedAt: null
  };
}

function steps() {
  return {
    mutationId: "steps:2026-10-05:v1",
    dayKey: "2026-10-05",
    steps: 5000,
    goal: 10000,
    source: "health_connect",
    observedAt: "2026-10-05T20:00:00.000Z",
    clientVersion: 1
  };
}
