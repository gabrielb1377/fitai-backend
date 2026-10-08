const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createProgressionSyncService
} = require("../../src/modules/progression/progression.sync.service");
const {
  parseProgressionSyncBatch,
  parseProgressionSyncEvent,
  CONTRACT_VERSION,
  RULES_VERSION
} = require("../../src/modules/progression/progression.sync.schemas");

test("XP-REMOTE-02/03/13: treino verificavel recebe 15 XP e ACK accepted", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-1", "completed");
  const result = await service(db).processBatch(batch("user-a", event("workout", "workout-1")));

  assert.equal(result.ack.accepted.length, 1);
  assert.equal(result.ack.accepted[0].xpAwarded, 15);
  assert.equal(result.state.balance.totalXp, 15);
});

test("XP-REMOTE-04: corrida verificavel recebe 10 XP", async () => {
  const db = memoryDatabase();
  db.seedRun("user-a", "run-1");
  const result = await service(db).processBatch(batch("user-a", event("running", "run-1")));

  assert.equal(result.ack.accepted[0].xpAwarded, 10);
  assert.equal(result.state.balance.totalXp, 10);
});

test("XP-REMOTE-05: meta de passos verificavel preserva 8 XP", async () => {
  const db = memoryDatabase();
  db.seedSteps("user-a", "2026-10-04", 10000, 10000);
  const result = await service(db).processBatch(batch("user-a", event("stepsGoal", "2026-10-04")));

  assert.equal(result.ack.accepted[0].xpAwarded, 8);
  assert.equal(result.state.balance.totalXp, 8);
});

test("XP-REMOTE-06/14: duplicate retorna alreadyApplied sem duplicar", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-1", "completed");
  const sync = service(db);
  const input = event("workout", "workout-1");

  await sync.processBatch(batch("user-a", input));
  const retry = await sync.processBatch(batch("user-a", input));

  assert.equal(retry.ack.alreadyApplied.length, 1);
  assert.equal(retry.state.balance.totalXp, 15);
  assert.equal(db.events.length, 1);
});

test("XP-REMOTE-07: dez retries continuam com um unico award", async () => {
  const db = memoryDatabase();
  db.seedRun("user-a", "run-retry");
  const sync = service(db);
  const input = event("running", "run-retry");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sync.processBatch(batch("user-a", input, `device-${attempt}`));
  }

  const state = await sync.pullState({ userId: "user-a" });
  assert.equal(state.balance.totalXp, 10);
  assert.equal(db.events.length, 1);
});

test("XP-REMOTE-08: source type desconhecido e rejeitado", async () => {
  const db = memoryDatabase();
  const input = { ...event("workout", "workout-1"), sourceType: "magic" };
  const result = await service(db).processBatch(batch("user-a", input));

  assert.equal(result.ack.rejected[0].code, "invalid_progression_event");
  assert.equal(db.events.length, 0);
});

test("XP-REMOTE-09: XP arbitrario nao pertence ao schema do evento", () => {
  const parsed = parseProgressionSyncEvent({
    ...event("workout", "workout-1"),
    xpAwarded: 999999
  });

  assert.equal(parsed.success, false);
});

test("XP-REMOTE-10: user A nao usa source de user B", async () => {
  const db = memoryDatabase();
  db.seedRun("user-b", "run-b");
  const result = await service(db).processBatch(batch("user-a", event("running", "run-b")));

  assert.equal(result.ack.rejected[0].code, "source_not_found");
  assert.equal(db.events.length, 0);
});

test("XP-REMOTE-11: pull e isolado pelo usuario autenticado", async () => {
  const db = memoryDatabase();
  db.seedRun("user-a", "run-a");
  const sync = service(db);
  await sync.processBatch(batch("user-a", event("running", "run-a")));

  const stateA = await sync.pullState({ userId: "user-a" });
  const stateB = await sync.pullState({ userId: "user-b" });
  assert.equal(stateA.balance.totalXp, 10);
  assert.equal(stateB.balance.totalXp, 0);
  assert.equal(stateB.events.length, 0);
});

test("XP-REMOTE-12: rules version invalida nao concede XP", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-1", "completed");
  const result = await service(db).processBatch({
    ...batch("user-a", { ...event("workout", "workout-1"), rulesVersion: 2 }),
    rulesVersion: 2
  });

  assert.equal(result.ack.rejected[0].code, "unsupported_rules_version");
  assert.equal(db.events.length, 0);
});

test("XP-REMOTE-15/16: pull por cursor reconstrui novo device", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-1", "completed");
  db.seedRun("user-a", "run-1");
  const sync = service(db);
  await sync.processBatch(batch("user-a", event("workout", "workout-1")));
  await sync.processBatch(batch("user-a", event("running", "run-1")));

  const initial = await sync.pullState({ userId: "user-a", afterRevision: "0" });
  const delta = await sync.pullState({ userId: "user-a", afterRevision: initial.revision });
  assert.equal(initial.balance.totalXp, 25);
  assert.equal(initial.events.length, 2);
  assert.equal(delta.events.length, 0);
});

test("XP-REMOTE-17: falha de persistencia nao cria saldo parcial", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-1", "completed");
  db.failNextCreate = true;

  await assert.rejects(
    service(db).processBatch(batch("user-a", event("workout", "workout-1"))),
    /persistence failure/
  );
  assert.equal(db.events.length, 0);
});

test("XP-REMOTE-18/XP-MULTI-02: unique semantico resolve corrida concorrente", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-shared", "completed");
  const sync = service(db);
  const first = event("workout", "workout-shared", "event-a");
  const second = event("workout", "workout-shared", "event-b");

  const [left, right] = await Promise.all([
    sync.processBatch(batch("user-a", first, "device-a")),
    sync.processBatch(batch("user-a", second, "device-b"))
  ]);

  assert.equal(left.ack.accepted.length + right.ack.accepted.length, 1);
  assert.equal(left.ack.alreadyApplied.length + right.ack.alreadyApplied.length, 1);
  assert.equal(db.events.length, 1);
});

test("XP-MULTI-01/04/05: treino A + corrida B convergem em 25 XP", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-a", "completed");
  db.seedRun("user-a", "run-b");
  const sync = service(db);

  await sync.processBatch(batch("user-a", event("workout", "workout-a"), "device-a"));
  await sync.processBatch(batch("user-a", event("running", "run-b"), "device-b"));
  const a = await sync.pullState({ userId: "user-a" });
  const b = await sync.pullState({ userId: "user-a" });

  assert.equal(a.balance.totalXp, 25);
  assert.deepEqual(b, a);
});

test("XP-MULTI-03: ACK perdido seguido de retry nao duplica", async () => {
  const db = memoryDatabase();
  db.seedRun("user-a", "run-lost-ack");
  const sync = service(db);
  const input = event("running", "run-lost-ack");

  await sync.processBatch(batch("user-a", input));
  const recovered = await sync.processBatch(batch("user-a", input));

  assert.equal(recovered.ack.alreadyApplied.length, 1);
  assert.equal(recovered.state.balance.totalXp, 10);
});

test("source ainda nao concluida permanece rejeitada sem award", async () => {
  const db = memoryDatabase();
  db.seedWorkout("user-a", "workout-active", "active");
  const result = await service(db).processBatch(batch("user-a", event("workout", "workout-active")));

  assert.equal(result.ack.rejected[0].code, "source_not_completed");
  assert.equal(db.events.length, 0);
});

test("eventId reutilizado para outra origem e conflito seguro", async () => {
  const db = memoryDatabase();
  db.seedRun("user-a", "run-1");
  db.seedRun("user-a", "run-2");
  const sync = service(db);
  await sync.processBatch(batch("user-a", event("running", "run-1", "same-event")));
  const conflict = await sync.processBatch(batch("user-a", event("running", "run-2", "same-event")));

  assert.equal(conflict.ack.rejected[0].code, "event_id_conflict");
  assert.equal(db.events.length, 1);
});

test("payload userId spoof e rejeitado pelo contrato estrito", () => {
  const parsed = parseProgressionSyncBatch({
    ...batch("user-a", event("workout", "workout-1")),
    userId: "user-b"
  });
  assert.equal(parsed.success, false);
});

function service(db) {
  return createProgressionSyncService({
    prismaClient: db,
    now: () => new Date("2026-10-04T12:00:00.000Z")
  });
}

function batch(userId, item, deviceId = "device-a") {
  return {
    userId,
    deviceId,
    contractVersion: CONTRACT_VERSION,
    rulesVersion: RULES_VERSION,
    afterRevision: "0",
    events: [item]
  };
}

function event(sourceType, sourceId, eventId = `${sourceType}:${sourceId}`) {
  return {
    eventId,
    sourceType,
    sourceId,
    occurredAt: "2026-10-04T10:00:00.000Z",
    rulesVersion: RULES_VERSION
  };
}

function memoryDatabase() {
  const state = {
    events: [],
    workouts: new Map(),
    histories: new Map(),
    runs: new Map(),
    steps: new Map(),
    revision: 0,
    failNextCreate: false
  };

  const db = {
    get events() { return state.events; },
    get failNextCreate() { return state.failNextCreate; },
    set failNextCreate(value) { state.failNextCreate = value; },
    seedWorkout(userId, sourceId, status) {
      state.workouts.set(`${userId}:${sourceId}`, { userId, externalSessionId: sourceId, status });
    },
    seedRun(userId, sourceId) {
      state.runs.set(`${userId}:${sourceId}`, { id: sourceId, userId });
    },
    seedSteps(userId, sourceId, steps, goal) {
      state.steps.set(`${userId}:${sourceId}`, {
        userId,
        date: new Date(`${sourceId}T00:00:00.000Z`),
        steps,
        goal
      });
    },
    async $transaction(callback) { return callback(db); },
    async $executeRaw() { return 0; },
    progressionXpEvent: {
      async findUnique({ where }) {
        if (where.userId_eventId) {
          const key = where.userId_eventId;
          return state.events.find((item) => item.userId === key.userId && item.eventId === key.eventId) || null;
        }
        const key = where.userId_sourceType_sourceId;
        return state.events.find((item) =>
          item.userId === key.userId && item.sourceType === key.sourceType && item.sourceId === key.sourceId
        ) || null;
      },
      async create({ data }) {
        if (state.failNextCreate) {
          state.failNextCreate = false;
          throw new Error("persistence failure");
        }
        const duplicate = state.events.some((item) =>
          (item.userId === data.userId && item.eventId === data.eventId) ||
          (item.userId === data.userId && item.sourceType === data.sourceType && item.sourceId === data.sourceId)
        );
        if (duplicate) throw Object.assign(new Error("unique"), { code: "P2002" });
        const record = {
          id: `remote-${state.revision + 1}`,
          revision: BigInt(++state.revision),
          ...data
        };
        state.events.push(record);
        return record;
      },
      async findMany({ where, take }) {
        return state.events
          .filter((item) => item.userId === where.userId &&
            (where.revision?.gt == null || item.revision > where.revision.gt))
          .sort((left, right) => Number(left.revision - right.revision))
          .slice(0, take);
      },
      async aggregate({ where }) {
        return { _sum: { xpAwarded: state.events.filter(e => e.userId === where.userId)
          .reduce((sum, e) => sum + e.xpAwarded, 0) } };
      },
      async findFirst({ where }) {
        return state.events.filter(e => e.userId === where.userId)
          .sort((a, b) => Number(b.revision - a.revision))[0] || null;
      }
    },
    workoutSyncSession: {
      async findUnique({ where }) {
        const key = where.userId_externalSessionId;
        return state.workouts.get(`${key.userId}:${key.externalSessionId}`) || null;
      }
    },
    workoutHistory: {
      async findFirst({ where }) {
        return state.histories.get(`${where.userId}:${where.id}`) || null;
      }
    },
    runningHistory: {
      async findFirst({ where }) {
        const sourceId = where.id || where.OR?.find((item) => item.id)?.id ||
          where.OR?.find((item) => item.externalRunId)?.externalRunId;
        return state.runs.get(`${where.userId}:${sourceId}`) || null;
      }
    },
    dailySteps: {
      async findUnique({ where }) {
        if (where.userId_dayKey) {
          const key = where.userId_dayKey;
          return state.steps.get(`${key.userId}:${key.dayKey}`) || null;
        }
        const key = where.userId_date;
        return state.steps.get(`${key.userId}:${key.date.toISOString().slice(0, 10)}`) || null;
      }
    }
  };
  return db;
}
