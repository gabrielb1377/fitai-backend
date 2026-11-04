const test = require("node:test");
const assert = require("node:assert/strict");
const { createFitnessContextEngine } = require("../../src/modules/ai/chat/fitness-context.engine");

// Mock completo de todos os modelos Prisma consultados pelo build() para analyze_progress.
function memoryDb(rows) {
  const data = {
    profile: rows.profile || null,
    goals: rows.goals || [],
    workoutSyncSession: rows.workoutSyncSession || [],
    runningHistory: rows.runningHistory || [],
    progressionXpEvent: rows.progressionXpEvent || [],
    dailySteps: rows.dailySteps || [],
    workout: rows.workout || []
  };
  const findMany = (arr, where, select, orderBy, take) => {
    let out = arr.filter((r) => {
      if (where.userId && r.userId !== where.userId) return false;
      if (where.status && r.status !== where.status) return false;
      if (where.deletedAt !== undefined && r.deletedAt !== where.deletedAt) return false;
      if (where.finishedAt) {
        const f = new Date(r.finishedAt).getTime();
        if (where.finishedAt.gte && f < new Date(where.finishedAt.gte).getTime()) return false;
        if (where.finishedAt.lte && f > new Date(where.finishedAt.lte).getTime()) return false;
      }
      if (where.occurredAt) {
        const o = new Date(r.occurredAt).getTime();
        if (where.occurredAt.gte && o < new Date(where.occurredAt.gte).getTime()) return false;
        if (where.occurredAt.lte && o > new Date(where.occurredAt.lte).getTime()) return false;
      }
      return true;
    });
    if (orderBy) {
      out.sort((a, b) => {
        for (const { [k]: dir } of orderBy) {
          const va = new Date(a[k]).getTime();
          const vb = new Date(b[k]).getTime();
          if (va !== vb) return dir === "asc" ? va - vb : vb - va;
        }
        return 0;
      });
    }
    if (take) out = out.slice(0, take);
    if (select) out = out.map((r) => Object.fromEntries(Object.entries(select).map(([k]) => [k, r[k]])));
    return out;
  };
  return {
    profile: { findUnique: async ({ where }) => (data.profile && data.profile.id === where.userId ? { ...data.profile } : null) },
    goal: { findMany: async ({ where, orderBy, take }) => findMany(data.goals, where, null, orderBy, take) },
    workoutSyncSession: { findMany: async ({ where, select, orderBy, take }) => findMany(data.workoutSyncSession, where, select, orderBy, take) },
    runningHistory: { findMany: async ({ where, select, orderBy, take }) => findMany(data.runningHistory, where, select, orderBy, take) },
    progressionXpEvent: {
      findMany: async ({ where, orderBy, take, select }) => findMany(data.progressionXpEvent, where, select, orderBy, take),
      aggregate: async ({ where, _sum }) => {
        const ev = data.progressionXpEvent.filter((e) => {
          if (where.userId && e.userId !== where.userId) return false;
          if (where.occurredAt) {
            const o = new Date(e.occurredAt).getTime();
            if (where.occurredAt.gte && o < new Date(where.occurredAt.gte).getTime()) return false;
            if (where.occurredAt.lte && o > new Date(where.occurredAt.lte).getTime()) return false;
          }
          return true;
        });
        return { _sum: { xpAwarded: ev.reduce((s, e) => s + (Number(e.xpAwarded) || 0), 0) }, _count: ev.length };
      }
    },
    dailySteps: { findMany: async ({ where, orderBy, take, select }) => findMany(data.dailySteps, where, select, orderBy, take) },
    workout: { findMany: async ({ where, select, orderBy, take }) => findMany(data.workout, where, select, orderBy, take) },
    $transaction: async (fn) => fn(this)
  };
}

function failingDb() {
  return {
    profile: { findUnique: async () => { throw new Error("db down"); } },
    goal: { findMany: async () => { throw new Error("db down"); } },
    workoutSyncSession: { findMany: async () => { throw new Error("db down"); } },
    runningHistory: { findMany: async () => { throw new Error("db down"); } },
    progressionXpEvent: { findMany: async () => { throw new Error("db down"); }, aggregate: async () => { throw new Error("db down"); } },
    dailySteps: { findMany: async () => { throw new Error("db down"); } },
    workout: { findMany: async () => { throw new Error("db down"); } },
    $transaction: async (fn) => fn(this)
  };
}

const now = new Date("2026-11-02T10:00:00Z"); // segunda-feira

const inWeekCompleted = (id, userId, finishedAt) => ({
  id, userId, externalSessionId: id, planId: "p", workoutId: "w", status: "completed",
  startedAt: new Date(finishedAt), finishedAt: new Date(finishedAt),
  historyRevision: null, currentExerciseIndex: 0, currentSetIndex: 0,
  restEndsAt: null, version: 1, createdAt: new Date(finishedAt), updatedAt: new Date(finishedAt), sets: []
});
const inWeekCancelled = (id, userId, finishedAt) => ({ ...inWeekCompleted(id, userId, finishedAt), status: "discarded" });
const outOfWeekCompleted = (id, userId, finishedAt) => ({ ...inWeekCompleted(id, userId, finishedAt), finishedAt: new Date("2026-10-26T10:00:00Z") });

const inWeekRun = (id, userId, finishedAt, distanceKm) => ({
  id, userId, externalRunId: id, distanceKm, durationSeconds: 1800,
  averageSpeed: distanceKm / (1800 / 3600), route: [], calories: null, steps: null,
  startedAt: new Date(finishedAt), finishedAt: new Date(finishedAt), performedAt: new Date(finishedAt),
  deletedAt: null, revision: 0, createdAt: new Date(finishedAt), updatedAt: new Date(finishedAt)
});
const deletedRun = (id, userId, finishedAt) => ({ ...inWeekRun(id, userId, finishedAt, 5), deletedAt: new Date(finishedAt) });
const outOfWeekRun = (id, userId) => ({ ...inWeekRun(id, userId, "2026-10-26T10:00:00Z", 5), finishedAt: new Date("2026-10-26T10:00:00Z") });

const xpEvent = (id, userId, sourceType, xpAwarded, occurredAt) => ({
  id, userId, deviceId: "d", eventId: id, idempotencyKey: id, sourceType, sourceId: id,
  rulesVersion: 1, xpAwarded, occurredAt: new Date(occurredAt), processedAt: new Date(occurredAt), revision: 1
});

test("WEEKLY-01: treinos concluídos da semana e dias com treino", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [
      inWeekCompleted("s1", "conta_a", "2026-11-02T10:00:00Z"),
      inWeekCompleted("s2", "conta_a", "2026-11-04T10:00:00Z"),
      inWeekCompleted("s3", "conta_a", "2026-11-04T15:00:00Z")
    ],
    runningHistory: [], progressionXpEvent: [], dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  const w = result.domains.weekly;
  assert.equal(w.status, "AVAILABLE");
  assert.equal(w.data.workoutsCompleted, 3);
  assert.equal(w.data.workoutDays, 2);
  assert.equal(w.data.workoutsCancelled, 0);
});

test("WEEKLY-02: treinos cancelados excluídos do concluído e contados separadamente", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [
      inWeekCompleted("s1", "conta_a", "2026-11-02T10:00:00Z"),
      inWeekCancelled("s2", "conta_a", "2026-11-03T10:00:00Z"),
      inWeekCancelled("s3", "conta_a", "2026-11-05T10:00:00Z")
    ],
    runningHistory: [], progressionXpEvent: [], dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  const w = result.domains.weekly;
  assert.equal(w.data.workoutsCompleted, 1);
  assert.equal(w.data.workoutsCancelled, 2);
});

test("WEEKLY-03: caminhadas e corridas no período (runningHistory não deletado)", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [],
    runningHistory: [
      inWeekRun("r1", "conta_a", "2026-11-03T08:00:00Z", 5),
      inWeekRun("r2", "conta_a", "2026-11-05T08:00:00Z", 3),
      deletedRun("r3", "conta_a", "2026-11-06T08:00:00Z"),
      outOfWeekRun("r4", "conta_a")
    ],
    progressionXpEvent: [], dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  const w = result.domains.weekly;
  assert.equal(w.data.runsCompleted, 2);
  assert.equal(w.data.totalDistanceKm, 8);
});

test("WEEKLY-04: XP semanal separado do XP acumulado", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [], runningHistory: [],
    progressionXpEvent: [
      xpEvent("e1", "conta_a", "workout", 15, "2026-11-02T10:00:00Z"),
      xpEvent("e2", "conta_a", "running", 10, "2026-11-04T10:00:00Z"),
      xpEvent("e3", "conta_a", "stepsGoal", 8, "2026-10-25T10:00:00Z"),
      xpEvent("e4", "conta_a", "workout", 15, "2026-10-20T10:00:00Z")
    ],
    dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  const w = result.domains.weekly;
  assert.equal(w.data.weeklyXp, 25);
  assert.equal(w.data.totalXp, 48);
  assert.notEqual(w.data.weeklyXp, w.data.totalXp);
});

test("WEEKLY-05: limites de semana — registros fora da semana não contam", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [outOfWeekCompleted("s1", "conta_a", "2026-10-26T10:00:00Z")],
    runningHistory: [outOfWeekRun("r1", "conta_a")],
    progressionXpEvent: [xpEvent("e1", "conta_a", "workout", 15, "2026-10-20T10:00:00Z")],
    dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  const w = result.domains.weekly;
  assert.equal(w.data.workoutsCompleted, 0);
  assert.equal(w.data.runsCompleted, 0);
  assert.equal(w.data.weeklyXp, 0);
  assert.equal(w.data.totalXp, 15);
});

test("WEEKLY-06: isolamento de conta — Conta A isolada da Conta B", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [
      inWeekCompleted("sA", "conta_a", "2026-11-02T10:00:00Z"),
      inWeekCompleted("sB1", "conta_b", "2026-11-02T10:00:00Z"),
      inWeekCompleted("sB2", "conta_b", "2026-11-03T10:00:00Z")
    ],
    runningHistory: [
      inWeekRun("rA", "conta_a", "2026-11-02T10:00:00Z", 5),
      inWeekRun("rB1", "conta_b", "2026-11-02T10:00:00Z", 3),
      inWeekRun("rB2", "conta_b", "2026-11-03T10:00:00Z", 4)
    ],
    progressionXpEvent: [
      xpEvent("eA", "conta_a", "workout", 15, "2026-11-02T10:00:00Z"),
      xpEvent("eB1", "conta_b", "workout", 15, "2026-11-02T10:00:00Z"),
      xpEvent("eB2", "conta_b", "running", 10, "2026-11-03T10:00:00Z")
    ],
    dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });

  const ca = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  assert.equal(ca.domains.weekly.data.workoutsCompleted, 1);
  assert.equal(ca.domains.weekly.data.runsCompleted, 1);
  assert.equal(ca.domains.weekly.data.weeklyXp, 15);

  const cb = await ctx.build({ userId: "conta_b", task: "analyze_progress", message: "Como foi minha semana?" });
  assert.equal(cb.domains.weekly.data.workoutsCompleted, 2);
  assert.equal(cb.domains.weekly.data.runsCompleted, 2);
  assert.equal(cb.domains.weekly.data.weeklyXp, 25);
});

test("WEEKLY-07: dados ausentes → EMPTY (não é falha)", async (t) => {
  const db = memoryDb({ workoutSyncSession: [], runningHistory: [], progressionXpEvent: [], dailySteps: [], workout: [] });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  assert.equal(result.domains.weekly.status, "EMPTY");
  assert.equal(result.domains.weekly.data.workoutsCompleted, 0);
  assert.equal(result.domains.weekly.data.weeklyXp, 0);
  assert.equal(result.domains.weekly.data.totalXp, 0);
});

test("WEEKLY-08: erro de carregamento → UNAVAILABLE (distinto de ausência)", async (t) => {
  const ctx = createFitnessContextEngine({ client: failingDb(), now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  assert.equal(result.domains.weekly.status, "UNAVAILABLE");
});

test("WEEKLY-09: integração — domínio weekly aparece no contexto do Coach", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [inWeekCompleted("s1", "conta_a", "2026-11-02T10:00:00Z")],
    runningHistory: [inWeekRun("r1", "conta_a", "2026-11-03T08:00:00Z", 5)],
    progressionXpEvent: [xpEvent("e1", "conta_a", "workout", 15, "2026-11-02T10:00:00Z")],
    dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  assert.equal(result.task, "analyze_progress");
  assert.equal(result.domains.weekly.status, "AVAILABLE");
  assert.equal(result.domains.weekly.data.workoutsCompleted, 1);
  assert.equal(result.domains.weekly.data.weeklyXp, 15);
  assert.equal(result.domains.weekly.data.totalXp, 15);
});

test("WEEKLY-10: fim do período é domingo (não 'agora')", async (t) => {
  const db = memoryDb({
    workoutSyncSession: [inWeekCompleted("s1", "conta_a", "2026-11-08T20:00:00Z")],
    runningHistory: [], progressionXpEvent: [], dailySteps: [], workout: []
  });
  const ctx = createFitnessContextEngine({ client: db, now: () => now });
  const result = await ctx.build({ userId: "conta_a", task: "analyze_progress", message: "Como foi minha semana?" });
  const w = result.domains.weekly;
  assert.equal(w.data.workoutsCompleted, 1);
  assert.ok(w.data.period.end >= "2026-11-08T23:59:59.000Z");
});
