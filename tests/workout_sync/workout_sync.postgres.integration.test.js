const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createWorkoutSyncService } = require("../../src/modules/workout_sync/workout_sync.service");

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_WORKOUT_SYNC_POSTGRES_TESTS === "1" && Boolean(testDatabaseUrl);
const prisma = enabled
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) })
  : null;

test("PostgreSQL: processa eventos uma vez e preserva conflitos", { skip: !enabled }, async () => {
  await withUser(async (user) => {
    const service = createWorkoutSyncService({ prismaClient: prisma });
    const ids = identifiers();
    const start = sessionEvent(ids);
    const set = setEvent(ids);

    const first = await service.processBatch({ userId: user.id, deviceId: ids.deviceId, events: [start, set] });
    const retry = await service.processBatch({ userId: user.id, deviceId: ids.deviceId, events: [set] });
    const divergent = setEvent(ids, {
      eventId: randomUUID(),
      idempotencyKey: `workout_set_completed:divergent:${ids.setId}`,
      payload: { set: { ...set.payload.set, weight: 60 } }
    });
    const conflict = await service.processBatch({ userId: user.id, deviceId: ids.deviceId, events: [divergent] });

    assert.equal(first.accepted.length, 2);
    assert.equal(retry.alreadyProcessed.length, 1);
    assert.equal(conflict.conflicts[0].reason, "set_payload_conflict");
    assert.equal(await prisma.workoutSyncSet.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.workoutSyncEvent.count({ where: { userId: user.id } }), 3);
  });
});

test("PostgreSQL: finalizacao, lote parcial e rollback sao classificaveis", { skip: !enabled }, async () => {
  await withUser(async (user) => {
    const service = createWorkoutSyncService({ prismaClient: prisma });
    const ids = identifiers();
    const start = sessionEvent(ids);
    const finish = sessionEvent(ids, {
      eventId: randomUUID(),
      idempotencyKey: `workout_session_finished:${ids.sessionId}`,
      eventType: "workout_session_finished",
      version: 2,
      payload: { session: { ...start.payload.session, finishedAt: "2026-07-30T10:30:00.000Z" } }
    });
    const invalidSetPayload = setEvent(ids, {
      eventId: randomUUID(),
      idempotencyKey: `workout_set_completed:invalid:${ids.setId}`,
      payload: { set: { id: ids.setId, sessionId: ids.sessionId } }
    });

    await service.processBatch({ userId: user.id, deviceId: ids.deviceId, events: [start, finish] });
    const retriedFinish = await service.processBatch({ userId: user.id, deviceId: ids.deviceId, events: [finish] });
    const partial = await service.processBatch({
      userId: user.id,
      deviceId: ids.deviceId,
      events: [
        { ...sessionEvent(identifiers()), eventId: randomUUID() },
        invalidSetPayload
      ]
    });

    assert.equal(retriedFinish.alreadyProcessed.length, 1);
    assert.equal(partial.accepted.length, 1);
    assert.equal(partial.rejected.length, 1);
    assert.equal(await prisma.workoutSyncSession.count({ where: { userId: user.id, status: "completed" } }), 1);
    assert.equal(await prisma.workoutSyncSet.count({ where: { userId: user.id } }), 0);
  });
});

test("PostgreSQL: usuario isolado e versao antiga nao alteram a sessao", { skip: !enabled }, async () => {
  await withUser(async (owner) => {
    await withUser(async (otherUser) => {
      const service = createWorkoutSyncService({ prismaClient: prisma });
      const ids = identifiers();
      const start = sessionEvent(ids);
      const pause = sessionEvent(ids, {
        eventId: randomUUID(),
        idempotencyKey: `workout_session_paused:${ids.sessionId}`,
        eventType: "workout_session_paused",
        version: 2
      });
      const staleResume = sessionEvent(ids, {
        eventId: randomUUID(),
        idempotencyKey: `workout_session_resumed:${ids.sessionId}`,
        eventType: "workout_session_resumed",
        version: 1
      });

      await service.processBatch({ userId: owner.id, deviceId: ids.deviceId, events: [start, pause] });
      const stale = await service.processBatch({ userId: owner.id, deviceId: ids.deviceId, events: [staleResume] });
      const forbidden = await service.processBatch({ userId: otherUser.id, deviceId: ids.deviceId, events: [setEvent(ids)] });

      assert.equal(stale.conflicts[0].reason, "stale_version");
      assert.equal(forbidden.conflicts[0].reason, "workout_session_not_found");
      assert.equal(await prisma.workoutSyncSet.count({ where: { userId: otherUser.id } }), 0);
    });
  });
});

test.after(async () => {
  if (prisma) await prisma.$disconnect();
});

async function withUser(callback) {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      name: "Workout Sync Integration",
      email: `workout-sync-${suffix}@fitia.test`,
      passwordHash: "not-used-by-integration-test"
    }
  });
  try {
    return await callback(user);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
}

function identifiers() {
  return {
    sessionId: randomUUID(),
    setId: randomUUID(),
    deviceId: `device-${randomUUID()}`
  };
}

function sessionEvent(ids, overrides = {}) {
  return {
    eventId: randomUUID(),
    idempotencyKey: `workout_session_started:${ids.sessionId}`,
    eventType: "workout_session_started",
    aggregateId: ids.sessionId,
    occurredAt: "2026-07-30T10:00:00.000Z",
    version: 1,
    payload: {
      session: {
        id: ids.sessionId,
        planId: "plan-integration",
        workoutId: "upper-a",
        startedAt: "2026-07-30T10:00:00.000Z",
        currentExerciseIndex: 0,
        currentSetIndex: 0
      }
    },
    ...overrides
  };
}

function setEvent(ids, overrides = {}) {
  return {
    eventId: randomUUID(),
    idempotencyKey: `workout_set_completed:${ids.setId}`,
    eventType: "workout_set_completed",
    aggregateId: ids.setId,
    occurredAt: "2026-07-30T10:05:00.000Z",
    version: 1,
    payload: {
      set: {
        id: ids.setId,
        sessionId: ids.sessionId,
        exerciseId: "bench-press-example",
        setIndex: 0,
        weight: 55,
        reps: 10,
        completedAt: "2026-07-30T10:05:00.000Z"
      }
    },
    ...overrides
  };
}
