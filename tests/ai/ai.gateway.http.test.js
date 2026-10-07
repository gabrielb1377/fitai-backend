const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const env = require("../../src/config/env");
const { authenticateJWT } = require("../../src/modules/auth/auth.middleware");
const asyncHandler = require("../../src/shared/utils/async-handler");
const errorHandler = require("../../src/shared/middleware/error-handler.middleware");
const { createGenerateWorkoutController } = require("../../src/modules/ai/controller/ai.controller");
const { claimWithinTransaction, currentPeriodStart, hashPayload, quotaFor, AI_OPERATIONS } = require("../../src/modules/ai/ai-usage.service");
const { createAiGateway } = require("../../src/modules/ai/gateway/gateway");
const { createAiConfig } = require("../../src/modules/ai/gateway/config");

const input = { objetivo: "hipertrofia", divisao: "ABC", nivel: "iniciante", diasPorSemana: 3,
  tempoPorTreino: 45, local: "academia", equipamentos: ["halteres"], restricoes: [], prioridades: [], minExerciciosPorDia: 6 };
function valid() {
  const names = ["Supino reto", "Remada curvada", "Elevacao lateral", "Triceps corda", "Puxada frontal", "Prancha frontal plank"];
  return { id: "stable-plan", nome: "Treino", descricao: "Plano valido", objetivo: "hipertrofia", nivel: "iniciante",
    tempoEstimado: 45, criadoPorIA: true, dataCriacao: "2026-10-06T12:00:00.000Z", exercicios: [],
    dias: [{ id: "day-fixed", nome: "Dia A", titulo: "Superior", diaSemana: "Segunda", exercicios: names.map((nome, i) => ({
      id: `item-${i}`, nome, categoria: "Superior", musculos: ["Superior"], equipamentos: ["Halteres"], series: 3, repeticoes: "8-12", descanso: 90 })) }] };
}
async function server(t, outcomes = [valid()]) {
  const rows = [], owners = [], calls = [], events = [];
  const tx = { aiUsage: {
    findUnique: async ({ where }) => rows.find((row) => Object.entries(where.userId_operation_idempotencyKey).every(([k, v]) => row[k] === v)),
    count: async ({ where }) => rows.filter((row) => row.userId === where.userId && row.operation === where.operation &&
      +row.periodStart === +where.periodStart && where.status.in.includes(row.status)).length,
    create: async ({ data }) => { const row = { ...data, id: randomUUID(), status: "pending" }; rows.push(row); return row; },
    update: async ({ where, data }) => Object.assign(rows.find((row) => row.id === where.id), data)
  } };
  const gateway = createAiGateway({ config: createAiConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "fixture-private-value",
    AI_PRIMARY_MODEL: "fixture/primary", AI_FALLBACK_MODELS: "fixture/fallback" }),
  adapters: { openrouter: { generate: async (request) => {
    calls.push(request);
    const value = outcomes.shift(); if (value instanceof Error) throw value;
    return { model: request.model, content: JSON.stringify(value), usage: {}, finishReason: "stop" };
  } } }, logger: (event) => events.push(event) });
  const controller = createGenerateWorkoutController({
    claimAiUsage: async (claim) => claimWithinTransaction({ ...claim, tx, requestHash: hashPayload(claim.input), periodStart: currentPeriodStart() }),
    completeAiUsage: async (id, response) => { await tx.aiUsage.update({ where: { id }, data: { response, status: "succeeded" } }); },
    failAiUsage: async (id, error) => { await tx.aiUsage.update({ where: { id }, data: { status: "failed", errorCode: error.code } }); },
    loadWorkoutContext: async (owner) => { owners.push(owner); return null; },
    generateWorkout: async (data, context, options) => (await gateway.generate({ input: data, requestId: options.requestId })).data
  });
  const app = express(); app.use(express.json());
  app.post("/ai/generate-workout", authenticateJWT, asyncHandler(controller)); app.use(errorHandler);
  const instance = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => { instance.closeAllConnections(); instance.close(resolve); }));
  return { rows, owners, calls, events, async post(owner = "user-a", key = "operation-0001", body = input) {
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
    if (owner) headers.Authorization = `Bearer ${jwt.sign({ sub: owner, typ: "access" }, env.jwtSecret, { expiresIn: "5m" })}`;
    const response = await fetch(`http://127.0.0.1:${instance.address().port}/ai/generate-workout`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), replay: response.headers.get("Idempotent-Replay") };
  } };
}

test("AI-QUOTA-01 + AI-IDEMP-01/02/03: fallback reserves once, replay has one logical effect", async (t) => {
  const h = await server(t, [Object.assign(new Error("private"), { status: 503 }), valid()]);
  const first = await h.post(); assert.equal(first.status, 200); assert.equal(h.calls.length, 2);
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].status, "succeeded");
  const replay = await h.post(); assert.equal(replay.status, 200); assert.equal(replay.replay, "true");
  assert.deepEqual(replay.body, first.body); assert.equal(h.calls.length, 2); assert.equal(h.rows.length, 1);
  assert.equal(h.events[0].requestId, h.rows[0].id);
});
test("AI-QUOTA-02/03: quota exhausted and failed retry cannot bypass quota", async (t) => {
  const h = await server(t);
  for (let i = 0; i < quotaFor(AI_OPERATIONS.workout); i++) h.rows.push({ id: randomUUID(), userId: "user-a",
    operation: AI_OPERATIONS.workout, periodStart: currentPeriodStart(), status: "succeeded", idempotencyKey: `used-${i}` });
  const first = await h.post(); assert.equal(first.status, 429); assert.equal(first.body.error, "ai_quota_exceeded");
  // Reuse a failed operation after other requests consumed today's allowance.
  h.rows.push({ id: randomUUID(), userId: "user-a", operation: AI_OPERATIONS.workout,
    periodStart: currentPeriodStart(), status: "failed", idempotencyKey: "operation-0001", requestHash: hashPayload({ ...input, observacoes: "" }) });
  const retry = await h.post(); assert.equal(retry.status, 429); assert.equal(h.calls.length, 0);
});
test("AI-IDEMP: different input on same key conflicts before provider call", async (t) => {
  const h = await server(t); await h.post();
  const response = await h.post("user-a", "operation-0001", { ...input, tempoPorTreino: 60 });
  assert.equal(response.status, 409); assert.equal(h.calls.length, 1);
});
test("AI-SEC-03/04: real JWT middleware enforces owner; same key isolates users", async (t) => {
  const h = await server(t, [valid(), { ...valid(), id: "plan-b" }]);
  const unauthorized = await h.post(null); assert.equal(unauthorized.status, 401); assert.equal(h.calls.length, 0);
  assert.equal((await h.post("user-a", "operation-0001", { ...input, userId: "user-b", model: "injected", provider: "injected" })).status, 200);
  const second = await h.post("user-b"); assert.equal(second.status, 200); assert.equal(second.body.id, "plan-b");
  assert.deepEqual(h.owners, ["user-a", "user-b"]); assert.equal(h.rows.length, 2);
  assert.equal(h.calls[0].model, "fixture/primary");
  assert.doesNotMatch(JSON.stringify(h.events), /user-a|user-b|Bearer|fixture-private-value/);
});
test("AI-SEC-05: sanitized HTTP error contains stable code/retryable/requestId, no internals", async (t) => {
  const h = await server(t, [Object.assign(new Error("PRIVATE URL/key/JWT"), { status: 401 })]);
  const response = await h.post(); assert.equal(response.status, 503);
  assert.equal(response.body.code, "ai_provider_auth_error"); assert.equal(response.body.error, response.body.code);
  assert.equal(response.body.retryable, false); assert.match(response.body.requestId, /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE|URL|key|JWT|stack|details/);
  assert.equal(h.rows[0].status, "failed"); assert.equal(h.calls.length, 1);
});
test("AI-GATEWAY: invalid request cannot reserve quota or invoke provider", async (t) => {
  const h = await server(t); assert.equal((await h.post("user-a", "operation-0001", {})).status, 400);
  assert.equal(h.calls.length, 0); assert.equal(h.rows.length, 0);
});
test("AI-IDEMP: failed client retry reuses operation ID and produces one result", async (t) => {
  const h = await server(t, [Object.assign(new Error("private"), { status: 503 }), Object.assign(new Error("private"), { status: 503 }), valid()]);
  assert.equal((await h.post()).status, 503); const id = h.rows[0].id;
  assert.equal((await h.post()).status, 200); assert.equal(h.rows.length, 1); assert.equal(h.rows[0].id, id);
  assert.equal(h.events[0].requestId, h.events[1].requestId);
});
