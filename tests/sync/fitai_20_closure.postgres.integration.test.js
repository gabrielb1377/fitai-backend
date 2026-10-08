const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSyncReadService } = require("../../src/modules/sync/sync.read.service");
const { createWorkoutSyncService } = require("../../src/modules/workout_sync/workout_sync.service");
const { createProgressionSyncService } = require("../../src/modules/progression/progression.sync.service");
const { createActivitySyncService } = require("../../src/modules/activity_sync/activity_sync.service");
const { syncSteps } = require("../../src/modules/steps/steps.service");
const { deleteWorkoutById, syncWorkouts, getWorkouts, syncRunning } = require("../../src/modules/sync/sync.service");
const enabled = process.env.RUN_FITAI_20_POSTGRES === "1";
const db = enabled ? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) }) : null;
test.after(async () => { if (db) await db.$disconnect(); });

test("FITAI-20 P1-1: completed history pages preserve stable IDs and source metadata", { skip: !enabled }, async () => {
  await withUser(async user => {
    const sync = createWorkoutSyncService({ prismaClient: db });
    const sessionId = randomUUID();
    const start = sessionEvent(sessionId, false);
    assert.equal((await sync.processBatch({ userId: user.id, deviceId: "device-a", events: [start] })).accepted.length, 1);
    const sets = Array.from({ length: 51 }, (_, i) => setEvent(sessionId, i));
    for (const events of [sets.slice(0, 50), sets.slice(50), [sessionEvent(sessionId, true)]]) {
      assert.equal((await sync.processBatch({ userId: user.id, deviceId: "device-a", events })).accepted.length, events.length);
    }
    const read = createSyncReadService({ db });
    const first = await read.pullHistory(user.id);
    assert.equal(first.sets.length, 50);
    assert.equal(first.hasMore, true);
    assert.equal(first.session.remoteHistoryComplete, false);
    assert.equal(first.session.workoutName, "Upper A");
    assert.equal(first.sets[0].exerciseName, "Supino");
    assert.deepEqual(await read.pullHistory(user.id), first);
    const next = await createSyncReadService({ db }).pullHistory(user.id, {
      afterRevision: first.revision, afterSetId: first.afterSetId
    });
    assert.equal(next.sets.length, 1);
    assert.equal(next.session.remoteHistoryComplete, true);
    assert.equal(next.hasMore, false);
    assert.equal(new Set([...first.sets, ...next.sets].map(s => s.id)).size, 51);
    assert.equal((await read.pullHistory(user.id, { afterRevision: next.revision })).session, null);
    await withUser(async other => assert.equal((await read.pullHistory(other.id)).session, null));
    assert.equal(await db.progressionXpEvent.count({ where: { userId: user.id } }), 0);
  });
});

test("FITAI-20 P1-2: bounded deletion delta survives retries and rejects resurrection", { skip: !enabled }, async () => {
  await withUser(async user => {
    const ids = [];
    for (let i = 0; i < 51; i++) {
      const id = randomUUID(); ids.push(id);
      const created = await syncWorkouts({ auth: { userId: user.id } }, {}, [{ id, nome: "Plan", exercicios: [] }]);
      assert.equal(created.workouts[0].id, id);
      assert.ok((await getWorkouts({ auth: { userId: user.id } })).workouts.some(plan => plan.id === id));
      await deleteWorkoutById(user.id, id, db);
    }
    const read = createSyncReadService({ db });
    const first = await read.pullPlanDeletions(user.id);
    assert.equal(first.deletions.length, 50);
    assert.equal(first.hasMore, true);
    assert.deepEqual(await read.pullPlanDeletions(user.id), first);
    const next = await read.pullPlanDeletions(user.id, { afterRevision: first.revision });
    assert.equal(next.deletions.length, 1);
    assert.equal(next.hasMore, false);
    const retry = await deleteWorkoutById(user.id, ids[0], db);
    assert.equal(retry.alreadyDeleted, true);
    const stale = (await syncWorkouts({ auth: { userId: user.id } }, {}, [{ id: ids[0], nome: "Stale" }])).workouts[0];
    assert.ok(stale.deletedAt);
    assert.equal(stale.name, "Plan");
    assert.equal((await getWorkouts({ auth: { userId: user.id } })).workouts.length, 0);
    assert.equal((await read.pullPlanDeletions(user.id, { afterRevision: next.revision })).deletions.length, 0);
    await withUser(async other => assert.equal((await read.pullPlanDeletions(other.id)).deletions.length, 0));
  });
});

test("FITAI-20 P1-3: bounded XP pagination, duplicate/distinct concurrency, lost ACK", { skip: !enabled }, async () => {
  await withUser(async user => {
    const sources = Array.from({ length: 125 }, () => randomUUID());
    await db.workoutSyncSession.createMany({ data: sources.map(id => ({
      userId: user.id, externalSessionId: id, planId: "plan", workoutId: "workout",
      startedAt: new Date("2026-10-08T10:00:00Z"), finishedAt: new Date("2026-10-08T11:00:00Z"),
      status: "completed", version: 2
    })) });
    const sync = createProgressionSyncService({ prismaClient: db });
    const event = id => ({ eventId: `xp:${id}`, sourceId: id, sourceType: "workout",
      occurredAt: "2026-10-08T11:00:00Z", rulesVersion: 1 });
    const submit = id => sync.processEvent({ userId: user.id, deviceId: "a", event: event(id) });
    const firstRace = await Promise.all(Array.from({ length: 8 }, () => submit(sources[0])));
    assert.equal(firstRace.filter(r => r.bucket === "accepted").length, 1);
    assert.equal(firstRace.filter(r => r.bucket === "alreadyApplied").length, 7);
    for (let offset = 1; offset < sources.length; offset += 10) {
      const results = await Promise.all(sources.slice(offset, offset + 10).map(submit));
      assert.ok(results.every(r => r.bucket === "accepted"));
    }
    const duplicate = await Promise.all(Array.from({ length: 8 }, () => submit(sources[0])));
    assert.ok(duplicate.every(r => r.bucket === "alreadyApplied"));
    const first = await sync.pullState({ userId: user.id });
    assert.equal(first.events.length, 50);
    assert.equal(first.hasMore, true);
    assert.equal(first.balance.totalXp, 1875);
    assert.deepEqual(await sync.pullState({ userId: user.id }), first);
    const next = await createProgressionSyncService({ prismaClient: db }).pullState({ userId: user.id, afterRevision: first.revision });
    assert.equal(next.events.length, 50);
    assert.equal(next.hasMore, true);
    const last = await sync.pullState({ userId: user.id, afterRevision: next.revision });
    assert.equal(last.events.length, 25);
    assert.equal(last.hasMore, false);
    assert.equal(new Set([...first.events, ...next.events, ...last.events].map(e => e.sourceId)).size, 125);
    assert.equal((await sync.pullState({ userId: user.id, afterRevision: last.revision })).events.length, 0);
    await withUser(async other => assert.equal((await sync.pullState({ userId: other.id })).events.length, 0));
  });
});

test("FITAI-20 P1-2: concurrent deletion/stale upsert preserves related history", { skip: !enabled }, async () => {
  await withUser(async user => {
    const id = randomUUID();
    await syncWorkouts({ auth: { userId: user.id } }, {}, [{ id, nome: "Plan" }]);
    const history = await db.workoutHistory.create({ data: { userId: user.id, workoutId: id,
      startedAt: new Date("2026-10-08T10:00:00Z"), finishedAt: new Date("2026-10-08T11:00:00Z"),
      totalVolume: 550, totalSets: 1, durationSeconds: 3600 } });
    const entered = deferred(); const release = deferred();
    const holding = db.$transaction(async tx => {
      await require("../../src/modules/activity_sync/activity_sync.service").lockUser(tx, user.id);
      entered.resolve(); await release.promise;
    });
    await entered.promise;
    const deleting = deleteWorkoutById(user.id, id, db);
    const stale = syncWorkouts({ auth: { userId: user.id } }, {}, [{ id, nome: "Stale" }]);
    try { await waitForAdvisoryWait(); } finally { release.resolve(); }
    await Promise.all([holding, deleting, stale]);
    const removed = await db.workout.findUnique({ where: { id } });
    assert.ok(removed.deletedAt);
    const revision = removed.deletionRevision;
    await deleteWorkoutById(user.id, id, db);
    await syncWorkouts({ auth: { userId: user.id } }, {}, [{ id, nome: "Resurrect" }]);
    assert.equal((await db.workout.findUnique({ where: { id } })).deletionRevision, revision);
    assert.ok(await db.workoutHistory.findUnique({ where: { id: history.id } }));
    await withUser(async other => {
      await assert.rejects(syncWorkouts({ auth: { userId: other.id } }, {}, [{ id, nome: "Foreign" }]),
        error => error.statusCode === 404 && error.code === "resource_not_found");
    });
  });
});

test("FITAI-20 migration: real SQL backfills completed/deleted legacy rows without dropping data", { skip: !enabled }, async () => {
  const schema = `fitai20_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("isolated migration rollback");
  const sql = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20261008190000_add_sync_closure_revisions/migration.sql"), "utf8");
  await assert.rejects(db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await tx.$executeRawUnsafe('CREATE TABLE "workout_sync_sessions" ("id" TEXT PRIMARY KEY, "userId" TEXT, "status" TEXT)');
    await tx.$executeRawUnsafe('CREATE TABLE "workouts" ("id" TEXT PRIMARY KEY, "userId" TEXT, "deletedAt" TIMESTAMP)');
    await tx.$executeRawUnsafe("INSERT INTO workout_sync_sessions VALUES ('done','owner','completed'), ('open','owner','active')");
    await tx.$executeRawUnsafe("INSERT INTO workouts VALUES ('deleted','owner',NOW()), ('live','owner',NULL)");
    for (const statement of sql.split(';').filter(s => s.trim())) {
      await tx.$executeRawUnsafe(statement);
    }
    const sessions = await tx.$queryRawUnsafe('SELECT * FROM workout_sync_sessions ORDER BY id');
    const plans = await tx.$queryRawUnsafe('SELECT * FROM workouts ORDER BY id');
    assert.equal(sessions.length, 2);
    assert.ok(sessions[0].historyRevision > 0n);
    assert.equal(sessions[1].historyRevision, null);
    assert.equal(plans.length, 2);
    assert.ok(plans[0].deletionRevision > 0n);
    assert.equal(plans[1].deletionRevision, null);
    throw rollback;
  }), error => error === rollback);
});

test("FITAI-20 P1-3: pull cannot skip an uncommitted XP revision at the page boundary", { skip: !enabled }, async () => {
  await withUser(async user => {
    const sources = Array.from({ length: 51 }, () => randomUUID());
    await db.workoutSyncSession.createMany({ data: sources.map(id => ({
      userId: user.id, externalSessionId: id, planId: "plan", workoutId: "workout",
      startedAt: new Date("2026-10-08T10:00:00Z"), finishedAt: new Date("2026-10-08T11:00:00Z"),
      status: "completed", version: 2
    })) });
    const allocated = deferred(); const release = deferred();
    const wrapped = {
      progressionXpEvent: db.progressionXpEvent,
      $transaction: cb => db.$transaction(tx => cb(new Proxy(tx, {
        get(target, key) {
          if (key === "progressionXpEvent") return new Proxy(target.progressionXpEvent, {
            get(model, method) {
              if (method === "create") return async args => {
                const record = await model.create(args); allocated.resolve();
                await release.promise; return record;
              };
              return Reflect.get(model, method);
            }
          });
          return Reflect.get(target, key);
        }
      })))
    };
    const event = sourceId => ({ eventId: `xp:${sourceId}`, sourceType: "workout", sourceId,
      occurredAt: "2026-10-08T11:00:00Z", rulesVersion: 1 });
    const sync = createProgressionSyncService({ prismaClient: db });
    for (const source of sources.slice(0, 49)) {
      await sync.processEvent({ userId: user.id, deviceId: "a", event: event(source) });
    }
    const first = createProgressionSyncService({ prismaClient: wrapped }).processEvent({
      userId: user.id, deviceId: "a", event: event(sources[49])
    });
    await allocated.promise;
    const second = sync.processEvent({ userId: user.id, deviceId: "b", event: event(sources[50]) });
    const reader = sync.pullState({ userId: user.id });
    try { await waitForAdvisoryWait(); } finally { release.resolve(); }
    await Promise.all([first, second, reader]);
    const state = await sync.pullState({ userId: user.id });
    assert.equal(state.events.length, 50);
    assert.equal(state.events[49].sourceId, sources[49]);
    assert.equal(state.hasMore, true);
    const last = await sync.pullState({ userId: user.id, afterRevision: state.revision });
    assert.equal(last.events.length, 1);
    assert.equal(last.events[0].sourceId, sources[50]);
    assert.equal(state.balance.totalXp, 765);
  });
});

test("FITAI-20 P1-4: legacy/V2 interleaving uses the same transaction lock", { skip: !enabled }, async () => {
  await withUser(async user => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const dayKey = `2026-10-${String(10 + attempt).padStart(2, "0")}`;
      const barrier = deferred(); const release = deferred();
      const wrapped = {
        user: db.user,
        $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
          get(target, key) {
            if (key === "activitySyncMutation") return {
              findFirst: async args => { const result = await target.activitySyncMutation.findFirst(args);
                barrier.resolve(); await release.promise; return result; }
            };
            return Reflect.get(target, key);
          }
        })))
      };
      const legacy = syncSteps({ auth: { userId: user.id } }, { clientId: "legacy" },
        [{ date: dayKey, steps: 6200, goal: 10000, source: "local" }], wrapped);
      await barrier.promise;
      const service = createActivitySyncService({ prismaClient: db });
      const observation = { mutationId: `steps:${dayKey}:v1`, dayKey, steps: 5900, goal: 10000,
        source: "health_connect", observedAt: `${dayKey}T12:00:00Z`, clientVersion: 1 };
      const v2 = service.processSteps({ userId: user.id, deviceId: "v2", steps: observation });
      try {
        await waitForAdvisoryWait();
      } finally { release.resolve(); }
      await Promise.all([legacy, v2]);
      assert.equal((await db.dailySteps.findUnique({ where: { userId_dayKey: { userId: user.id, dayKey } } })).steps, 5900);
      assert.equal((await service.processSteps({ userId: user.id, deviceId: "v2", steps: observation })).bucket, "alreadyApplied");
      await syncSteps({ auth: { userId: user.id } }, { clientId: "legacy" },
        [{ date: dayKey, steps: 6200, source: "local" }], db);
      assert.equal((await db.dailySteps.findUnique({ where: { userId_dayKey: { userId: user.id, dayKey } } })).steps, 5900);
    }
  });
});

test("FITAI-20 P1-4: Running legacy/V2 interleaving, replay and tombstone are atomic", { skip: !enabled }, async () => {
  await withUser(async user => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const runId = randomUUID();
      const entered = deferred(); const release = deferred();
      const wrapped = {
        user: db.user,
        $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, {
          get(target, key) {
            if (key === "activitySyncMutation") return {
              findFirst: async args => {
                const result = await target.activitySyncMutation.findFirst(args);
                entered.resolve(); await release.promise; return result;
              }
            };
            return Reflect.get(target, key);
          }
        })))
      };
      const run = { mutationId: `run:${runId}:v1`, runId,
        startedAt: new Date("2026-10-08T10:00:00.000Z"), finishedAt: new Date("2026-10-08T10:30:00.000Z"),
        durationSeconds: 1800, distanceKm: 5, averageSpeed: 10, paceMinutesPerKm: 6,
        route: [], calories: null, steps: null, deletedAt: null };
      const legacyItem = { id: runId, data: run.finishedAt, startTime: run.startedAt,
        endTime: run.finishedAt, distancia: 5, segundos: 1800, velocidadeMedia: 10, route: [] };
      const legacy = syncRunning({ auth: { userId: user.id } }, {}, [legacyItem], wrapped);
      await entered.promise;
      const service = createActivitySyncService({ prismaClient: db });
      const v2 = service.processRun({ userId: user.id, deviceId: "v2", run });
      try { await waitForAdvisoryWait(); } finally { release.resolve(); }
      const [, outcome] = await Promise.all([legacy, v2]);
      assert.equal(outcome.bucket, "alreadyApplied");
      assert.equal((await service.pullState({ userId: user.id })).runs.filter(r => r.runId === runId).length, 1);
      assert.equal((await service.processRun({ userId: user.id, deviceId: "v2", run })).bucket, "alreadyApplied");
      const tombstone = { ...run, mutationId: `run:${runId}:delete`, deletedAt: new Date("2026-10-08T11:00:00.000Z") };
      assert.equal((await service.processRun({ userId: user.id, deviceId: "v2", run: tombstone })).bucket, "updated");
      await syncRunning({ auth: { userId: user.id } }, {}, [{ ...legacyItem, distancia: 8 }], db);
      const stored = await db.runningHistory.findUnique({ where: { userId_externalRunId: { userId: user.id, externalRunId: runId } } });
      assert.equal(stored.distanceKm, 5);
      assert.ok(stored.deletedAt);
      assert.equal(await db.runningHistory.count({ where: { userId: user.id, externalRunId: runId } }), 1);
      const state = await service.pullState({ userId: user.id });
      assert.ok(state.runs.find(r => r.runId === runId).deletedAt);
      await withUser(async other => {
        assert.equal((await service.pullState({ userId: other.id })).runs.length, 0);
      });
    }
  });
});

async function waitForAdvisoryWait() {
  const until = Date.now() + 2500;
  while (Date.now() < until) {
    const rows = await db.$queryRaw`SELECT COUNT(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    if (rows[0].count > 0) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("PostgreSQL lock wait was not observed");
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function withUser(callback) {
  const user = await db.user.create({ data: { name: "FITAI20", email: `${randomUUID()}@fitia.test`, passwordHash: "unused" } });
  try { return await callback(user); } finally { await db.user.delete({ where: { id: user.id } }); }
}
function sessionEvent(id, finish) {
  return { eventId: randomUUID(), idempotencyKey: `workout_session_${finish ? "finished" : "started"}:${id}`,
    eventType: `workout_session_${finish ? "finished" : "started"}`, aggregateId: id,
    occurredAt: "2026-10-08T11:00:00Z", version: finish ? 2 : 1, payload: { session: {
      id, planId: "plan", workoutId: "upper", planName: "Plan", workoutName: "Upper A",
      startedAt: "2026-10-08T10:00:00Z", ...(finish ? { finishedAt: "2026-10-08T11:00:00Z" } : {}),
      currentExerciseIndex: 0, currentSetIndex: 0
    } } };
}
function setEvent(sessionId, index) {
  const id = `set-${String(index).padStart(3, "0")}-${sessionId}`;
  return { eventId: randomUUID(), idempotencyKey: `workout_set_completed:${id}`,
    eventType: "workout_set_completed", aggregateId: id, occurredAt: "2026-10-08T10:30:00Z", version: 1,
    payload: { set: { id, sessionId, exerciseId: "bench", canonicalExerciseId: "peito_001",
      exerciseName: "Supino", setIndex: index, weight: 55, reps: 10,
      completedAt: "2026-10-08T10:30:00Z", version: 1, restSeconds: 90 } } };
}
