const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseWorkoutSyncBatch,
  parseWorkoutSyncEvent
} = require("../../src/modules/workout_sync/workout_sync.schemas");

function event(overrides = {}) {
  return {
    eventId: "event-1",
    idempotencyKey: "workout_session_started:session-1",
    eventType: "workout_session_started",
    aggregateId: "session-1",
    occurredAt: "2026-07-30T10:00:00.000Z",
    version: 1,
    payload: { session: { id: "session-1" } },
    ...overrides
  };
}

test("aceita apenas o contrato minimo de evento e lote", () => {
  const batch = parseWorkoutSyncBatch({ deviceId: "device-1", events: [event()] });
  const parsedEvent = parseWorkoutSyncEvent(event());

  assert.equal(batch.success, true);
  assert.equal(parsedEvent.success, true);
  assert.equal(parsedEvent.data.eventType, "workout_session_started");
});

test("rejeita tipo fora da allowlist, payload grande e lote invalido", () => {
  assert.equal(parseWorkoutSyncEvent(event({ eventType: "nutrition_logged" })).success, false);
  assert.equal(parseWorkoutSyncEvent(event({ payload: { text: "x".repeat(20001) } })).success, false);
  assert.equal(parseWorkoutSyncBatch({ deviceId: "device-1", events: [] }).success, false);
  assert.equal(
    parseWorkoutSyncBatch({ deviceId: "device-1", events: Array.from({ length: 21 }, event) }).success,
    false
  );
});
