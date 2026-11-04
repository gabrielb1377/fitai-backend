const { randomUUID } = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../../src/config/prisma");
const { createFitnessContextEngine } = require("../../src/modules/ai/chat/fitness-context.engine");

const enabled = process.env.RUN_COACH_WEEKLY_POSTGRES_TESTS === "1" && Boolean(process.env.TEST_DATABASE_URL);
const now = new Date("2026-11-02T10:00:00Z");

test("Coach IA V1.3 PostgreSQL: resumo semanal - contagem de treinos, cancelados, corridas, XP semanal vs acumulado e isolamento de contas", { skip: !enabled }, async (t) => {
  const userA = await prisma.user.create({
    data: { name: "integracao-conta_a", email: `coach-weekly-${randomUUID()}-a@fitia.test`, passwordHash: "integration-fixture" }
  });
  const userB = await prisma.user.create({
    data: { name: "integracao-conta_b", email: `coach-weekly-${randomUUID()}-b@fitia.test`, passwordHash: "integration-fixture" }
  });
  const a = userA.id, b = userB.id;

  try {
    // ---------- Conta A: 3 treinos concluídos (dias 02, 04, 04), 1 cancelado (dia 03) ----------
    await prisma.workoutSyncSession.create({
      data: { userId: a, externalSessionId: `sess-a1-${randomUUID()}`, planId: "plan-a", workoutId: "workout-a",
        status: "completed", startedAt: new Date("2026-11-02T09:00:00Z"), finishedAt: new Date("2026-11-02T10:00:00Z") }
    });
    await prisma.workoutSyncSession.create({
      data: { userId: a, externalSessionId: `sess-a2-${randomUUID()}`, planId: "plan-a", workoutId: "workout-a",
        status: "completed", startedAt: new Date("2026-11-04T09:00:00Z"), finishedAt: new Date("2026-11-04T10:00:00Z") }
    });
    await prisma.workoutSyncSession.create({
      data: { userId: a, externalSessionId: `sess-a3-${randomUUID()}`, planId: "plan-a", workoutId: "workout-a",
        status: "completed", startedAt: new Date("2026-11-04T14:00:00Z"), finishedAt: new Date("2026-11-04T15:00:00Z") }
    });
    await prisma.workoutSyncSession.create({
      data: { userId: a, externalSessionId: `sess-a4-${randomUUID()}`, planId: "plan-a", workoutId: "workout-a",
        status: "discarded", startedAt: new Date("2026-11-03T09:00:00Z"), finishedAt: new Date("2026-11-03T10:00:00Z") }
    });

    // ---------- Conta A: 2 corridas ----------
    await prisma.runningHistory.create({
      data: { userId: a, externalRunId: `run-a1-${randomUUID()}`, distanceKm: 5, durationSeconds: 1800,
        averageSpeed: 10, paceMinutesPerKm: 6, route: [], calories: null, steps: null,
        startedAt: new Date("2026-11-03T08:00:00Z"), finishedAt: new Date("2026-11-03T09:00:00Z"),
        performedAt: new Date("2026-11-03T09:00:00Z"), deletedAt: null, revision: 0,
        createdAt: new Date("2026-11-03T09:00:00Z"), updatedAt: new Date("2026-11-03T09:00:00Z") }
    });
    await prisma.runningHistory.create({
      data: { userId: a, externalRunId: `run-a2-${randomUUID()}`, distanceKm: 3, durationSeconds: 1800,
        averageSpeed: 6, paceMinutesPerKm: 10, route: [], calories: null, steps: null,
        startedAt: new Date("2026-11-05T08:00:00Z"), finishedAt: new Date("2026-11-05T09:00:00Z"),
        performedAt: new Date("2026-11-05T09:00:00Z"), deletedAt: null, revision: 0,
        createdAt: new Date("2026-11-05T09:00:00Z"), updatedAt: new Date("2026-11-05T09:00:00Z") }
    });

    // ---------- Conta A: XP semanal (15) ----------
    await prisma.progressionXpEvent.create({
      data: { userId: a, deviceId: "fixture", eventId: randomUUID(), idempotencyKey: randomUUID(),
        sourceType: "workout", sourceId: randomUUID(), rulesVersion: 1, xpAwarded: 15,
        occurredAt: new Date("2026-11-02T10:00:00Z"), processedAt: new Date("2026-11-02T10:00:00Z") }
    });

    // ---------- Conta B: isolamento ----------
    await prisma.workoutSyncSession.create({
      data: { userId: b, externalSessionId: `sess-b1-${randomUUID()}`, planId: "plan-a", workoutId: "workout-a",
        status: "completed", startedAt: new Date("2026-11-02T09:00:00Z"), finishedAt: new Date("2026-11-02T10:00:00Z") }
    });
    await prisma.workoutSyncSession.create({
      data: { userId: b, externalSessionId: `sess-b2-${randomUUID()}`, planId: "plan-a", workoutId: "workout-a",
        status: "completed", startedAt: new Date("2026-11-03T09:00:00Z"), finishedAt: new Date("2026-11-03T10:00:00Z") }
    });
    await prisma.runningHistory.create({
      data: { userId: b, externalRunId: `run-b1-${randomUUID()}`, distanceKm: 4, durationSeconds: 1800,
        averageSpeed: 8, paceMinutesPerKm: 7.5, route: [], calories: null, steps: null,
        startedAt: new Date("2026-11-02T10:00:00Z"), finishedAt: new Date("2026-11-02T11:00:00Z"),
        performedAt: new Date("2026-11-02T11:00:00Z"), deletedAt: null, revision: 0,
        createdAt: new Date("2026-11-02T11:00:00Z"), updatedAt: new Date("2026-11-02T11:00:00Z") }
    });
    await prisma.progressionXpEvent.create({
      data: { userId: b, deviceId: "fixture", eventId: randomUUID(), idempotencyKey: randomUUID(),
        sourceType: "workout", sourceId: randomUUID(), rulesVersion: 1, xpAwarded: 15,
        occurredAt: new Date("2026-11-02T10:00:00Z"), processedAt: new Date("2026-11-02T10:00:00Z") }
    });

    const engine = createFitnessContextEngine({ now: () => now });
    const contextA = await engine.build({ userId: a, task: "analyze_progress", message: "Como foi minha semana?" });
    const contextB = await engine.build({ userId: b, task: "analyze_progress", message: "Como foi minha semana?" });

    const weeklyA = contextA.domains.weekly;
    const weeklyB = contextB.domains.weekly;

    // ---------- Estrutura FitnessContext/v1 ----------
    assert.equal(contextA.task, "analyze_progress");
    assert.equal(contextA.domains.weekly.status, "AVAILABLE");
    assert.ok(weeklyA.data.period.start);
    assert.ok(weeklyA.data.period.end);

    // ---------- Treinos concluidos (3), cancelado separado ----------
    assert.equal(weeklyA.data.workoutsCompleted, 3, "Conta A: 3 treinos concluidos");
    assert.equal(weeklyA.data.workoutsCancelled, 1, "Conta A: 1 cancelado separado");
    assert.equal(weeklyA.data.workoutDays, 2, "Conta A: 2 dias com treino");

    // ---------- Corridas ----------
    assert.equal(weeklyA.data.runsCompleted, 2, "Conta A: 2 corridas");
    assert.equal(weeklyA.data.totalDistanceKm, 8, "Conta A: 8 km");

    // ---------- XP semanal vs acumulado ----------
    assert.equal(weeklyA.data.weeklyXp, 15, "Conta A: XP semanal = 15");
    assert.equal(weeklyA.data.totalXp, 15, "Conta A: XP acumulado = 15");
    assert.equal(weeklyA.data.weeklyXp, weeklyA.data.totalXp, "Somente 1 evento XP => semanal == acumulado");

    // ---------- Isolamento de contas ----------
    assert.equal(weeklyB.data.workoutsCompleted, 2, "Conta B: 2 treinos (isolado de A)");
    assert.equal(weeklyB.data.runsCompleted, 1, "Conta B: 1 corrida (isolado de A)");
    assert.equal(weeklyB.data.weeklyXp, 15, "Conta B: XP semanal = 15 (apenas dela)");
    assert.equal(weeklyA.data.workoutsCompleted, 3, "Resumo de A nao contem treinos de B");
    assert.equal(weeklyA.data.runsCompleted, 2, "Resumo de A nao contem corridas de B");

    // ---------- Contexto do Coach ----------
    assert.equal(contextA.domains.weekly.source, "WeeklySummaryContract/v1");
    assert.equal(contextA.contractVersion, "FitnessContext/v1");

    // ---------- Conta sem atividades na semana (EMPTY) ----------
    const emptyUser = await prisma.user.create({
      data: { name: "sem-atividade", email: `coach-weekly-empty-${randomUUID()}@fitia.test`, passwordHash: "integration-fixture" }
    });
    const contextEmpty = await engine.build({ userId: emptyUser.id, task: "analyze_progress", message: "Como foi minha semana?" });
    assert.equal(contextEmpty.domains.weekly.status, "EMPTY");
    assert.equal(contextEmpty.domains.weekly.data.workoutsCompleted, 0);
    assert.equal(contextEmpty.domains.weekly.data.weeklyXp, 0);
    assert.equal(contextEmpty.domains.weekly.data.totalXp, 0);

    // ---------- Limpeza ----------
    await prisma.user.delete({ where: { id: emptyUser.id } }).catch(() => undefined);
  } finally {
    await prisma.progressionXpEvent.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.runningHistory.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.workoutSyncSet.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.workoutSyncSession.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.user.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
  }
});
