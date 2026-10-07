const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const prisma = require("../../src/config/prisma");
const { createChatService } = require("../../src/modules/ai/chat/chat.service");
const { createFitnessContextEngine } = require("../../src/modules/ai/chat/fitness-context.engine");
const enabled = process.env.RUN_AI_CHAT_POSTGRES_TESTS === "1" && Boolean(process.env.TEST_DATABASE_URL);

test("AI PostgreSQL: ownership, context, order, idempotency, restart, concurrency and atomic rollback", { skip: !enabled }, async (t) => {
  const users = await Promise.all(["a", "b"].map((suffix) => prisma.user.create({ data: {
    name: suffix, email: `ai-chat-${randomUUID()}-${suffix}@fitia.test`, passwordHash: "integration-fixture"
  } })));
  const [a, b] = users.map((u) => u.id);
  t.after(async () => { await prisma.user.deleteMany({ where: { id: { in: [a, b] } } }); await prisma.$disconnect(); });
  const date = new Date("2026-10-07T10:00:00Z"), calls = [];
  await prisma.profile.create({ data: { userId: a, weight: 70, height: 175, age: 30, goal: "strength", level: "intermediate" } });
  const session = await prisma.workoutSyncSession.create({ data: { userId: a, externalSessionId: randomUUID(), planId: "plan-a",
    workoutId: "workout-a", status: "completed", startedAt: new Date(+date - 600000), finishedAt: date } });
  await prisma.workoutSyncSet.create({ data: { userId: a, sessionId: session.id, externalSetId: randomUUID(), exerciseId: "ombros_003",
    setIndex: 0, weight: 10, reps: 12, completedAt: date } });
  await prisma.progressionXpEvent.create({ data: { userId: a, deviceId: "fixture", eventId: randomUUID(), idempotencyKey: randomUUID(),
    sourceType: "workout", sourceId: session.externalSessionId, rulesVersion: 1, xpAwarded: 15, occurredAt: date } });
  await prisma.dailySteps.create({ data: { userId: a, date, dayKey: "2026-10-07", steps: 8000, goal: 8000,
    source: "manual", deviceId: "fixture", observedAt: date } });
  await prisma.runningHistory.create({ data: { userId: a, externalRunId: randomUUID(), distanceKm: 1, durationSeconds: 300,
    averageSpeed: 12, paceMinutesPerKm: 5, startedAt: new Date(+date - 300000), finishedAt: date, performedAt: date,
    route: [{ timestamp: new Date(+date - 300000).toISOString(), cumulativeDistanceKm: 0, activeElapsedSeconds: 0, latitude: 99, longitude: 99 },
      { timestamp: date.toISOString(), cumulativeDistanceKm: 1, activeElapsedSeconds: 300, latitude: 99, longitude: 99 }] } });
  const engine = createFitnessContextEngine({ now: () => date });
  const contextA = await engine.build({ userId: a, task: "analyze_progress" });
  assert.equal(contextA.domains.strength.status, "AVAILABLE");
  assert.equal(contextA.domains.strength.data.recentFinalized[0].volumeKgReps, 120);
  assert.equal(contextA.domains.progression.data.totalXp, 15);
  assert.equal(contextA.domains.steps.data.recentDays[0].steps, 8000);
  assert.equal(contextA.domains.running.data.recent[0].distanceKm, 1);
  assert.doesNotMatch(JSON.stringify(contextA), /latitude|longitude|passwordHash|@fitia.test/);
  const contextB = await engine.build({ userId: b, task: "analyze_progress" });
  assert.equal(contextB.domains.strength.status, "EMPTY");
  assert.equal(contextB.domains.steps.status, "EMPTY");
  const gateway = { generate: async (request) => { calls.push(request); return { data: { content: "Orientacao read-only." } }; } };
  const make = (overrides = {}) => createChatService({ contextEngine: engine, gateway, ...overrides });
  const input = { contractVersion: "AiChatContract/v1", clientRequestId: randomUUID(), message: "Como foi meu treino?" };
  const first = (await make().send({ userId: a, input })).response;
  const replay = await make().send({ userId: a, input });
  assert.equal(replay.replay, true); assert.deepEqual(replay.response, first); assert.equal(calls.length, 1);
  await assert.rejects(make().history({ userId: b, conversationId: first.conversationId }), { code: "conversation_not_found" });
  await assert.rejects(make().send({ userId: b, input: { ...input, conversationId: first.conversationId } }), { code: "conversation_not_found" });
  const second = (await make().send({ userId: a, input: { ...input, conversationId: first.conversationId,
    clientRequestId: randomUUID(), message: "E a anterior?" } })).response;
  const history = await make().history({ userId: a, conversationId: first.conversationId });
  assert.deepEqual(history.messages.map((m) => m.id), [first.userMessageId, first.messageId, second.userMessageId, second.messageId]);
  assert.equal(calls[1].input.history.length, 2);
  let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const slow = make({ gateway: { generate: async () => { started(); await new Promise((resolve) => { release = resolve; }); return { data: { content: "Ok" } }; } } });
  const pending = slow.send({ userId: a, input: { ...input, conversationId: first.conversationId, clientRequestId: randomUUID() } });
  await waiting;
  await assert.rejects(make().send({ userId: a, input: { ...input, conversationId: first.conversationId,
    clientRequestId: randomUUID() } }), { code: "ai_request_in_progress" });
  release(); await pending;
  const before = await prisma.aiChatMessage.count();
  const rollbackId = randomUUID();
  await assert.rejects(make({ gateway: { generate: async () => ({ data: { content: null } }) } }).send({ userId: a,
    input: { ...input, clientRequestId: rollbackId } }));
  assert.equal(await prisma.aiChatMessage.count(), before);
  assert.equal((await prisma.aiUsage.findFirst({ where: { userId: a, idempotencyKey: rollbackId } })).status, "failed");
  await make().send({ userId: a, input: { ...input, clientRequestId: rollbackId } });
  assert.equal(await prisma.aiChatMessage.count(), before + 2);
  assert.equal(await prisma.workoutSyncSet.count({ where: { userId: a } }), 1);
  for (let attempt = 0; attempt < 5; attempt++) {
    const concurrentInput = { ...input, clientRequestId: randomUUID() };
    const results = await Promise.allSettled([make().send({ userId: a, input: concurrentInput }), make().send({ userId: a, input: concurrentInput })]);
    assert.ok(results.some((r) => r.status === "fulfilled"));
    for (const result of results.filter((r) => r.status === "rejected")) assert.equal(result.reason.code, "ai_request_in_progress");
    const usage = await prisma.aiUsage.findFirst({ where: { userId: a, idempotencyKey: concurrentInput.clientRequestId } });
    assert.equal(await prisma.aiChatMessage.count({ where: { usageId: usage.id } }), 2);
  }
});
