const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const prisma = require("../../src/config/prisma");
const { createActionService } = require("../../src/modules/ai/actions/action.service");
const { createChatService } = require("../../src/modules/ai/chat/chat.service");
const { syncWorkouts } = require("../../src/modules/sync/sync.service");
const { samplePlan } = require("./action.fixture");
const { include } = require("../../src/modules/ai/actions/plan.snapshot");
const { projection } = require("../../src/modules/ai/gateway/catalog");
const enabled = process.env.RUN_AI_ACTION_POSTGRES_TESTS === "1" && Boolean(process.env.TEST_DATABASE_URL);

function planDto(snapshot) {
  return { ...snapshot, exercicios: snapshot.exercicios.map((e) => ({ ...e, nome: `Canonico ${e.id}`, categoria: "Ombros", equipamentos: ["halteres"] })) };
}

test("AI Actions PostgreSQL: persisted proposals, R2 sync verification, A/B, concurrency and generated binding", { skip: !enabled }, async (t) => {
  const users = await Promise.all(["a", "b"].map((suffix) => prisma.user.create({ data: { name: suffix,
    email: `ai-actions-${randomUUID()}-${suffix}@fitia.test`, passwordHash: "fixture" } })));
  const [a, b] = users.map((u) => u.id);
  t.after(async () => { await prisma.user.deleteMany({ where: { id: { in: [a, b] } } }); await prisma.$disconnect(); });
  const req = { auth: { userId: a } };
  const initial = samplePlan(a);
  const snapshot = require("../../src/modules/ai/actions/plan.snapshot").planSnapshot(initial);
  await syncWorkouts(req, {}, [planDto(snapshot)]);
  const planId = initial.id;
  const session = await prisma.workoutSyncSession.create({ data: { userId: a, externalSessionId: randomUUID(), planId,
    workoutId: "A", status: "completed", startedAt: new Date(), finishedAt: new Date() } });
  await prisma.workoutSyncSet.create({ data: { userId: a, sessionId: session.id, externalSetId: randomUUID(), exerciseId: "ombros_003",
    setIndex: 0, weight: 10, reps: 12, completedAt: new Date() } });
  const candidate = { type: "REPLACE_EXERCISE", planId, previousExerciseId: "ombros_003", canonicalExerciseId: "ombros_004", reason: "Equipamento disponivel." };
  const chat = createChatService({ gateway: { generate: async () => ({ data: { content: "Revise a sugestao.", actions: [candidate] } }) } });
  const input = { clientRequestId: randomUUID(), message: "Trocar exercicio", contractVersion: "AiChatContract/v1" };
  const response = (await chat.send({ userId: a, input })).response;
  const action = response.actions[0], make = () => createActionService();
  assert.equal(action.status, "VALIDATED");
  assert.equal((await prisma.workout.findFirst({ where: { id: planId }, include })).days[0].exercises[0].exerciseId, "ombros_003");
  assert.deepEqual((await chat.send({ userId: a, input })).response.actions, response.actions);
  assert.equal(await prisma.aiActionProposal.count({ where: { userId: a } }), 1);
  await assert.rejects(make().confirm({ userId: b, actionId: action.actionId, deviceId: "b" }), { code: "ai_action_not_found" });
  await assert.rejects(make().complete({ userId: a, actionId: action.actionId }), { code: "ai_action_confirmation_required" });
  const confirmations = await Promise.all([1, 2].map(() => make().confirm({ userId: a, actionId: action.actionId, deviceId: "device-a" })));
  assert.ok(confirmations.every((r) => r.status === "CONFIRMED"));
  assert.equal((await make().complete({ userId: a, actionId: action.actionId })).status, "CONFIRMED");
  // Existing domain sync receives the output of the local R2 command. AI does not introduce another writer.
  await syncWorkouts(req, {}, [planDto(confirmations[0].expectedAfter)]);
  assert.equal((await make().complete({ userId: a, actionId: action.actionId })).status, "EXECUTED");
  assert.equal((await make().confirm({ userId: a, actionId: action.actionId, deviceId: "device-a" })).status, "EXECUTED");
  assert.equal((await prisma.workoutSyncSet.findFirst({ where: { userId: a } })).exerciseId, "ombros_003");
  const sourceMessageId = response.messageId, conversationId = response.conversationId;
  let sequence = 100;
  const add = { type: "ADD_EXERCISE_TO_PLAN", planId, dayOrder: 1, canonicalExerciseId: "ombros_005", sets: 3, repetitions: "10", restSeconds: 60, reason: "Alternativa." };
  const propose = async (p) => (await make().propose({ userId: a, conversationId, sourceMessageId: (await prisma.aiChatMessage.create({ data: {
    conversationId, usageId: randomUUID(), role: "assistant", content: "Sugestao", taskType: "chat", sequence: sequence++ } })).id, candidates: [p] }))[0];
  const cancelled = await propose(add); await make().cancel({ userId: a, actionId: cancelled.actionId });
  await assert.rejects(make().confirm({ userId: a, actionId: cancelled.actionId, deviceId: "device-a" }), { code: "ai_action_not_confirmable" });
  const stale = await propose(add); await prisma.workout.update({ where: { id: planId }, data: { name: "Nome alterado" } });
  assert.equal((await make().confirm({ userId: a, actionId: stale.actionId, deviceId: "device-a" })).status, "REJECTED");
  await assert.rejects(make().propose({ userId: b, conversationId, sourceMessageId, candidates: [add] }), { code: "conversation_not_found" });
  // Successful generate_workout artifact passes the same catalog validator, preserving occurrence IDs.
  const names = Object.keys(projection.nameBindings).filter((n, i, all) => all.findIndex((v) => projection.nameBindings[v] === projection.nameBindings[n]) === i).slice(0, 6);
  const entries = names.map((nome, i) => ({ id: `occurrence-${randomUUID()}-${i}`, nome, categoria: "Geral", musculos: [], equipamentos: [], series: 3, repeticoes: "10", descanso: 60 }));
  const workout = { id: randomUUID(), nome: "Plano gerado", descricao: "Geracao valida de teste", objetivo: "Hipertrofia", nivel: "Iniciante",
    tempoEstimado: 45, criadoPorIA: true, dataCriacao: new Date().toISOString(), dias: [{ id: "A", nome: "A", titulo: "Full Body", diaSemana: "Segunda", exercicios: entries }], exercicios: entries };
  const generation = await prisma.aiUsage.create({ data: { userId: a, operation: "workout_generation", idempotencyKey: randomUUID(), requestHash: "fixture", status: "succeeded", response: workout,
    periodStart: new Date(), completedAt: new Date() } });
  const generated = await propose({ type: "USE_GENERATED_WORKOUT", generationRequestId: generation.id, reason: "Salvar treino validado." });
  assert.equal(generated.status, "VALIDATED"); const confirmed = await make().confirm({ userId: a, actionId: generated.actionId, deviceId: "device-a" });
  assert.equal(confirmed.status, "CONFIRMED"); await syncWorkouts(req, {}, [planDto(confirmed.expectedAfter)]);
  assert.equal((await make().complete({ userId: a, actionId: generated.actionId })).status, "EXECUTED");
  assert.equal(await prisma.workout.count({ where: { id: confirmed.expectedAfter.id, userId: a } }), 1);
  const invalid = await propose({ type: "USE_GENERATED_WORKOUT", generationRequestId: randomUUID(), reason: "Sem artefato." }); assert.equal(invalid.status, "REJECTED");
  const incompatible = await propose({ ...candidate, previousExerciseId: "ombros_004", canonicalExerciseId: "costas_002" });
  assert.equal(incompatible.status, "REJECTED");
  assert.equal(incompatible.validation.code, "ai_action_incompatible_replacement");
  assert.equal((await prisma.workout.findFirst({ where: { id: planId }, include })).days[0].exercises[0].exerciseId, "ombros_004");
  assert.equal(await prisma.workoutSyncSet.count({ where: { userId: a } }), 1);
});
