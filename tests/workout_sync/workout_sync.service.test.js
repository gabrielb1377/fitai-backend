const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWorkoutSyncService
} = require("../../src/modules/workout_sync/workout_sync.service");

const userId = "user-a";
const deviceId = "device-a";

test("processa uma serie uma vez e reconhece retry idempotente", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });
  const start = sessionEvent();
  const set = setEvent();

  const first = await service.processBatch({ userId, deviceId, events: [start, set] });
  const second = await service.processBatch({ userId, deviceId, events: [set] });

  assert.equal(first.accepted.length, 2);
  assert.equal(second.alreadyProcessed.length, 1);
  assert.equal(database.state.sets.length, 1);
  assert.equal(database.state.events.length, 2);
});

test("retorna conflito para o mesmo setId com conteudo divergente", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });
  await service.processBatch({ userId, deviceId, events: [sessionEvent(), setEvent()] });
  const divergent = setEvent({
    eventId: "event-set-divergent",
    idempotencyKey: "workout_set_completed:set-divergent",
    payload: {
      set: { ...setEvent().payload.set, weight: 60 }
    }
  });

  const result = await service.processBatch({ userId, deviceId, events: [divergent] });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, "set_payload_conflict");
  assert.equal(database.state.sets.length, 1);
});

test("finalizar duas vezes nao duplica a sessao nem o evento confirmado", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });
  const finish = sessionEvent({
    eventId: "event-finish",
    idempotencyKey: "workout_session_finished:session-1",
    eventType: "workout_session_finished",
    version: 2,
    payload: {
      session: { ...sessionEvent().payload.session, finishedAt: "2026-07-30T10:30:00.000Z", version: 2 }
    }
  });
  await service.processBatch({ userId, deviceId, events: [sessionEvent(), finish] });
  const retry = await service.processBatch({ userId, deviceId, events: [finish] });

  assert.equal(retry.alreadyProcessed.length, 1);
  assert.equal(database.state.sessions.length, 1);
  assert.equal(database.state.sessions[0].status, "completed");
});

test("rejeita versao antiga sem aplicar last-write-wins silencioso", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });
  const pause = sessionEvent({
    eventId: "event-pause",
    idempotencyKey: "workout_session_paused:session-1",
    eventType: "workout_session_paused",
    version: 2,
    payload: { session: { ...sessionEvent().payload.session, version: 2 } }
  });
  const staleResume = sessionEvent({
    eventId: "event-resume-stale",
    idempotencyKey: "workout_session_resumed:session-1",
    eventType: "workout_session_resumed",
    version: 1,
    payload: { session: sessionEvent().payload.session }
  });
  await service.processBatch({ userId, deviceId, events: [sessionEvent(), pause] });

  const result = await service.processBatch({ userId, deviceId, events: [staleResume] });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, "stale_version");
});

test("lote parcial confirma evento valido e rejeita evento invalido", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });

  const result = await service.processBatch({
    userId,
    deviceId,
    events: [sessionEvent(), { eventId: "invalid", eventType: "unknown" }]
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(database.state.sessions.length, 1);
});

test("usuario nao acessa sessao de outro usuario", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });
  await service.processBatch({ userId, deviceId, events: [sessionEvent()] });

  const result = await service.processBatch({
    userId: "user-b",
    deviceId: "device-b",
    events: [setEvent()]
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].reason, "workout_session_not_found");
  assert.equal(database.state.sets.length, 0);
});

test("progresso e troca de exercício atualizam a mesma sessão", async () => {
  const database = createMemoryPrisma();
  const service = createWorkoutSyncService({ prismaClient: database });
  const progress = sessionEvent({
    eventId: "event-progress",
    idempotencyKey: "workout_session_progressed:session-1:2",
    eventType: "workout_session_progressed",
    version: 2,
    payload: {
      session: {
        ...sessionEvent().payload.session,
        currentExerciseIndex: 1,
        currentSetIndex: 0,
        restEndsAt: "2026-07-30T10:02:00.000Z",
        version: 2
      }
    }
  });
  const changed = sessionEvent({
    eventId: "event-exercise-change",
    idempotencyKey: "workout_exercise_changed:session-1:3",
    eventType: "workout_exercise_changed",
    version: 3,
    payload: {
      session: {
        ...progress.payload.session,
        restEndsAt: null,
        version: 3
      },
      change: "replace"
    }
  });

  const result = await service.processBatch({
    userId,
    deviceId,
    events: [sessionEvent(), progress, changed]
  });

  assert.equal(result.accepted.length, 3);
  assert.equal(database.state.sessions.length, 1);
  assert.equal(database.state.sessions[0].currentExerciseIndex, 1);
  assert.equal(database.state.sessions[0].version, 3);
});

function sessionEvent(overrides = {}) {
  return {
    eventId: "event-start",
    idempotencyKey: "workout_session_started:session-1",
    eventType: "workout_session_started",
    aggregateId: "session-1",
    occurredAt: "2026-07-30T10:00:00.000Z",
    version: 1,
    payload: {
      session: {
        id: "session-1",
        planId: "plan-1",
        workoutId: "upper-a",
        startedAt: "2026-07-30T10:00:00.000Z",
        currentExerciseIndex: 0,
        currentSetIndex: 0,
        restEndsAt: null,
        version: 1
      }
    },
    ...overrides
  };
}

function setEvent(overrides = {}) {
  return {
    eventId: "event-set-1",
    idempotencyKey: "workout_set_completed:set-1",
    eventType: "workout_set_completed",
    aggregateId: "set-1",
    occurredAt: "2026-07-30T10:05:00.000Z",
    version: 1,
    payload: {
      set: {
        id: "set-1",
        sessionId: "session-1",
        exerciseId: "bench-press-example",
        setIndex: 0,
        weight: 55,
        reps: 10,
        completedAt: "2026-07-30T10:05:00.000Z",
        version: 1
      }
    },
    ...overrides
  };
}

function createMemoryPrisma() {
  const state = { events: [], sessions: [], sets: [] };
  let nextId = 1;
  const id = () => `local-${nextId++}`;
  const client = {
    workoutSyncEvent: {
      findFirst: async ({ where }) => state.events.find((item) =>
        item.userId === where.userId && where.OR.some((candidate) =>
          candidate.idempotencyKey === item.idempotencyKey || candidate.eventId === item.eventId
        )
      ) || null,
      create: async ({ data }) => {
        const item = { id: id(), ...data };
        state.events.push(item);
        return item;
      }
    },
    workoutSyncSession: {
      findUnique: async ({ where }) => {
        if (where.id) return state.sessions.find((item) => item.id === where.id) || null;
        const key = where.userId_externalSessionId;
        return state.sessions.find((item) => item.userId === key.userId && item.externalSessionId === key.externalSessionId) || null;
      },
      create: async ({ data }) => {
        const item = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...data };
        state.sessions.push(item);
        return item;
      },
      update: async ({ where, data }) => {
        const index = state.sessions.findIndex((item) => item.id === where.id);
        state.sessions[index] = { ...state.sessions[index], ...data, updatedAt: new Date() };
        return state.sessions[index];
      }
    },
    workoutSyncSet: {
      findUnique: async ({ where }) => {
        if (where.userId_externalSetId) {
          const key = where.userId_externalSetId;
          return state.sets.find((item) => item.userId === key.userId && item.externalSetId === key.externalSetId) || null;
        }
        const key = where.sessionId_exerciseId_setIndex;
        return state.sets.find((item) => item.sessionId === key.sessionId && item.exerciseId === key.exerciseId && item.setIndex === key.setIndex) || null;
      },
      create: async ({ data }) => {
        const item = { id: id(), createdAt: new Date(), updatedAt: new Date(), ...data };
        state.sets.push(item);
        return item;
      }
    }
  };

  return {
    ...client,
    state,
    $transaction: async (callback) => callback(client)
  };
}
