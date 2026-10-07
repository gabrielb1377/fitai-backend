const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateAiResponse, privateViolations, CATEGORIES } = require("../../src/modules/ai/reliability/semantic-evaluator");
const { runSemanticScenarios } = require("../../src/modules/ai/reliability/eval-harness");
const { scenarios, context } = require("./semantic.fixture");
const { createAiConfig } = require("../../src/modules/ai/gateway/config");
const { createAiGateway } = require("../../src/modules/ai/gateway/gateway");
const { createFitnessContextEngine, BUDGET, selectContextDomains } = require("../../src/modules/ai/chat/fitness-context.engine");
const { selectTask } = require("../../src/modules/ai/chat/chat.schema");
const { buildChatPrompt } = require("../../src/modules/ai/chat/chat.prompt");
const { replacementCompatibility, projection } = require("../../src/modules/ai/gateway/catalog");
const { fixture: actionFixture } = require("./action.fixture");

for (const s of scenarios) test(s.id + " reference and fault probe", () => {
  const report = runSemanticScenarios([s]);
  assert.equal(report.failed, 0, JSON.stringify(report.results));
  assert.equal(report.p0, 0); assert.equal(report.p1, 0);
});

test("AI-EVAL-CONSISTENCY classification and scoring repeat exactly", () => {
  const a = runSemanticScenarios(scenarios), b = runSemanticScenarios(scenarios);
  assert.deepEqual(a, b); assert.equal(a.failed, 0); assert.equal(a.warnings, 0);
  assert.deepEqual(Object.keys(a.byCategory), CATEGORIES);
  assert.ok(Object.values(a.byCategory).every((c) => c.scenarios > 0));
});

function gatewayHarness(outputs) {
  const calls = [], config = createAiConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "synthetic-eval-key",
    AI_PRIMARY_MODEL: "fixture/primary", AI_FALLBACK_MODELS: "fixture/fallback" });
  const gateway = createAiGateway({ config, logger: () => {}, adapters: { openrouter: { generate: async (input) => {
    calls.push(input); const outcome = outputs.shift(); if (outcome instanceof Error) throw outcome;
    return { content: JSON.stringify(outcome), finishReason: "stop", model: input.model };
  } } } });
  return { calls, gateway };
}
test("AI-EVAL-FALLBACK semantic invalid primary uses one fallback with unchanged context/action/history", async () => {
  const h = gatewayHarness([{ content: "Seu ultimo supino reto foi 75 kg x 8." }, { content: "Seu ultimo supino reto foi 70 kg x 8." }]);
  const input = { message: "Qual o ultimo supino reto?", context: context(),
    history: [{ role: "user", content: "Ultima sessao?" }, { role: "assistant", content: "Vou consultar os registros." }],
    actionContext: { available: true, plans: [] } };
  const answer = await h.gateway.generate({ task: "chat", input });
  assert.equal(answer.metadata.attemptCount, 2); assert.deepEqual(h.calls[0].messages, h.calls[1].messages);
  assert.match(h.calls[1].messages[2].content, /ACTION_CONTEXT_DATA/);
});
test("AI-EVAL-FALLBACK primary valid calls no fallback", async () => {
  const h = gatewayHarness([{ content: "Seu ultimo supino reto foi 70 kg x 8." }]);
  await h.gateway.generate({ task: "chat", input: { message: "Supino reto?", context: context() } });
  assert.equal(h.calls.length, 1);
});
test("AI-EVAL-FALLBACK invalid outputs exhaust semantic budget without persisting a fabricated metric", async () => {
  const h = gatewayHarness([{ content: "Voce correu 5.5 km." }, { content: "Voce correu 5.5 km." }]);
  await assert.rejects(h.gateway.generate({ task: "chat", input: { message: "Corrida?", context: context() } }), { code: "ai_semantic_validation_error" });
  assert.equal(h.calls.length, 2);
});
test("AI-EVAL-FALLBACK timeout preserves conversation prompt/action state", async () => {
  const h = gatewayHarness([Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" }), { content: "Considere manter consistencia." }]);
  await h.gateway.generate({ task: "running_advice", input: { message: "E a anterior?", context: context(), history: [{ role: "assistant", content: "5 km." }], actionContext: { available: false } } });
  assert.deepEqual(h.calls[0].messages, h.calls[1].messages);
});

test("AI-EVAL-CTX-02 strength and steps questions exclude unrelated domains; cross-domain retains them", () => {
  assert.deepEqual(selectContextDomains("chat", "Devo aumentar a carga do supino?"), ["profile", "goals", "progression", "strength", "currentPlan"]);
  assert.deepEqual(selectContextDomains("chat", "Meta de passos atingida?"), ["profile", "goals", "progression", "steps"]);
  assert.ok(selectContextDomains("analyze_progress", "Devo treinar pernas hoje?").includes("steps"));
  assert.equal(selectTask({ message: "Como foi a semana com musculacao e corrida?" }), "analyze_progress");
  assert.equal(selectTask({ message: "Devo aumentar a carga?" }, "running_advice"), "chat");
  assert.equal(selectTask({ message: "E comparando com a anterior?" }, "running_advice"), "running_advice");
});

function engineFixture() {
  const queries = [], owner = "user-a";
  const query = (name, value) => async (args) => { queries.push({ name, args }); assert.equal(args.where.userId, owner); return value; };
  const now = new Date("2026-10-07T12:00:00Z");
  const client = { profile: { findUnique: query("profile", { goal: "forca", level: "iniciante", refreshToken: "private" }) },
    goal: { findMany: query("goals", []) }, workout: { findMany: query("plans", []) },
    progressionXpEvent: { aggregate: query("xp", { _sum: { xpAwarded: 0 }, _count: 0 }), findMany: query("xpEvents", []) },
    workoutSyncSession: { findMany: query("strength", Array.from({ length: 5 }, () => ({ startedAt: now, finishedAt: now,
      _count: { sets: 48 }, sets: Array.from({ length: 48 }, () => ({ exerciseId: "peito_001", weight: 70, reps: 8, setIndex: 0 })) }))) },
    runningHistory: { findMany: query("runs", [{ distanceKm: 5, durationSeconds: 1600, averageSpeed: 11.25, finishedAt: now,
      route: [{ latitude: -12.12345, longitude: -38.54321 }] }]) },
    dailySteps: { findMany: query("steps", [{ dayKey: "2026-10-06", steps: 8000, goal: 8000, rawHealth: "RAW_HEALTH_SAMPLE" }]) } };
  return { queries, client, engine: createFitnessContextEngine({ client, now: () => now }) };
}
test("AI-EVAL-CTX-01 large history remains query bounded and serialized bounded", async () => {
  const h = engineFixture(), c = await h.engine.build({ userId: "user-a", task: "analyze_progress", message: "Como foi minha semana?" });
  assert.ok(Buffer.byteLength(JSON.stringify(c)) <= BUDGET.bytes);
  assert.ok(h.queries.filter((q) => q.args.take).every((q) => q.args.take <= 48));
  assert.equal(c.domains.strength.data.recentFinalized.length, 5);
  assert.equal(c.domains.strength.data.recentFinalized[0].performance.length, 12);
  assert.deepEqual(privateViolations(c), []);
  assert.deepEqual(privateViolations(buildChatPrompt({ context: c, message: "Como evoluir?" })), []);
});
test("AI-EVAL-PRIV actual context excludes GPS, Health, auth metadata and foreign data", async () => {
  const h = engineFixture(), c = await h.engine.build({ userId: "user-a", task: "analyze_progress" });
  const serialized = JSON.stringify(c);
  assert.doesNotMatch(serialized, /latitude|longitude|rawHealth|RAW_HEALTH_SAMPLE|refreshToken|user-a/);
  h.client.profile.findUnique = async () => ({ goal: "Bearer synthetic.secret.token", level: "iniciante" });
  assert.equal((await h.engine.build({ userId: "user-a", task: "chat" })).domains.profile.data.fitnessGoal, null);
});
test("AI-EVAL-ACTION actual service rejects incompatible replacement without writing fitness data", async () => {
  const h = actionFixture();
  const proposal = await h.propose({ ...h.replace, canonicalExerciseId: "costas_002" });
  assert.equal(proposal.status, "REJECTED"); assert.equal(proposal.validation.code, "ai_action_incompatible_replacement");
});
test("AI-EVAL-CATALOG metadata remains a read-only projection of 362 identities", () => {
  assert.equal(Object.keys(projection.exerciseMetadata).length, projection.canonicalIds.length);
  assert.equal(projection.nameBindings["elevacao lateral"], "ombros_003");
  assert.equal(replacementCompatibility("ombros_003", "ombros_004"), "UNKNOWN");
  assert.equal(replacementCompatibility("peito_001", "costas_002"), "INCOMPATIBLE");
  assert.equal(replacementCompatibility("unknown", "ombros_004"), "UNKNOWN");
});
test("AI-EVAL categories do not trust model-supplied evidence/owner/status fields", () => {
  const s = scenarios.find((x) => x.id === "AI-EVAL-CATALOG-01");
  const candidate = { ...s.response.actions[0], userId: "foreign", confirmed: true, status: "EXECUTED" };
  const result = evaluateAiResponse({ ...s, response: { content: "Proposta.", actions: [candidate] } });
  assert.equal(result.passed, false); assert.ok(result.findings.some((f) => f.code === "invalid_action_schema"));
});

test("AI-EVAL trusted expected action constraints remain distinct from provider output", () => {
  const s = scenarios.find((x) => x.id === "AI-EVAL-CATALOG-01");
  assert.equal(evaluateAiResponse({ ...s, expectedActionConstraints: { allowedTypes: ["REPLACE_EXERCISE"], allowedPlanIds: ["plan-a"], requireConfirmation: true } }).passed, true);
  assert.equal(evaluateAiResponse({ ...s, expectedActionConstraints: { allowedTypes: ["USE_GENERATED_WORKOUT"] } }).passed, false);
});

test("AI-EVAL separating a registered fact and a recommendation cannot hide a fabricated number", () => {
  const input = { context: context(), question: "Supino reto?", response: { content: "Seu ultimo supino reto foi 75 kg x 8; considere revisar a tecnica." } };
  assert.equal(evaluateAiResponse(input).passed, false);
  input.response.content = "Seu ultimo supino reto foi 70 kg x 8; considere revisar a tecnica.";
  assert.equal(evaluateAiResponse(input).passed, true);
});

test("AI-EVAL bounded selection is enforced in actual reads, not only by task labels", async () => {
  const h = engineFixture();
  const c = await h.engine.build({ userId: "user-a", task: "chat", message: "Carga do supino?" });
  assert.equal(Object.hasOwn(c.domains, "running"), false); assert.equal(Object.hasOwn(c.domains, "steps"), false);
  assert.ok(h.queries.every((q) => !["runs", "steps"].includes(q.name)));
});

test("AI-EVAL recommendation label cannot launder a past fabricated running fact", () => {
  const response = { content: "Considere que sua ultima corrida foi 5.5 km." };
  assert.equal(evaluateAiResponse({ context: context(), response }).passed, false);
});
test("AI-EVAL an unsupported trend without a number is still not a registered fact", () => {
  const response = { content: "Seu volume subiu." };
  assert.ok(evaluateAiResponse({ context: context(), response }).findings.some((f) => f.code === "trend_without_canonical_metric"));
});

test("AI-EVAL chat serializable retry does not repeat provider or quota and commits once", async () => {
  const { memoryClient } = require("./chat.fixture");
  const { createChatService } = require("../../src/modules/ai/chat/chat.service");
  const { randomUUID } = require("node:crypto");
  const h = memoryClient(), waits = [];
  const transaction = h.client.$transaction;
  let calls = 0, claims = 0, conflicts = 0;
  h.client.$transaction = (fn, options) => {
    if (options && calls === 1 && conflicts++ < 2) return Promise.reject({ code: "P2034" });
    return transaction(fn);
  };
  const service = createChatService({ client: h.client, claim: async (args) => { claims++; return h.claim(args); },
    fail: h.fail, wait: async (ms) => waits.push(ms),
    contextEngine: { build: async () => context() }, actionService: { context: async () => ({}), propose: async () => [] },
    gateway: { generate: async () => { calls++; return { data: { content: "Revise a tecnica." } }; } } });
  await service.send({ userId: "a", input: { clientRequestId: randomUUID(), message: "Supino?" } });
  assert.deepEqual(waits, [50, 100]);
  assert.equal(calls, 1); assert.equal(claims, 1); assert.equal(h.messages.length, 2);
  assert.equal(h.usages[0].status, "succeeded");
});

test("AI-EVAL action serializable retry is bounded and never swallows an unrelated error", async () => {
  const { createActionService } = require("../../src/modules/ai/actions/action.service");
  const h = actionFixture(), p = await h.propose(), waits = [];
  let attempts = 0;
  h.client.$transaction = async () => { attempts++; throw { code: "P2034" }; };
  const service = createActionService({ client: h.client, wait: async (ms) => waits.push(ms) });
  await assert.rejects(service.confirm({ userId: "a", actionId: p.actionId, deviceId: "device-a" }), { code: "P2034" });
  assert.equal(attempts, 5); assert.deepEqual(waits, [50, 100, 200, 400]);
  assert.equal(h.rows[0].status, "VALIDATED");
  attempts = 0; waits.length = 0;
  h.client.$transaction = async () => { attempts++; throw { code: "P2003" }; };
  await assert.rejects(service.confirm({ userId: "a", actionId: p.actionId, deviceId: "device-a" }), { code: "P2003" });
  assert.equal(attempts, 1); assert.deepEqual(waits, []);
});

test("AI-EVAL action serializable retry retains explicit owner/device confirmation", async () => {
  const { createActionService } = require("../../src/modules/ai/actions/action.service");
  const h = actionFixture(), p = await h.propose(), waits = [];
  const transaction = h.client.$transaction;
  let attempts = 0;
  h.client.$transaction = (fn) => ++attempts < 3 ? Promise.reject({ code: "P2034" }) : transaction(fn);
  const service = createActionService({ client: h.client, wait: async (ms) => waits.push(ms) });
  const result = await service.confirm({ userId: "a", actionId: p.actionId, deviceId: "device-a" });
  assert.equal(result.status, "CONFIRMED"); assert.equal(result.executionDeviceId, "device-a");
  assert.deepEqual(waits, [50, 100]); assert.equal(h.rows.length, 1);
});

test("AI-EVAL expected evidence coverage and real action-context keys cannot inflate a score", () => {
  const s = scenarios.find((x) => x.id === "AI-EVAL-CATALOG-01");
  const planId = s.response.actions[0].planId;
  assert.equal(evaluateAiResponse({ ...s, actionContext: { plans: [{ planId }] } }).passed, true);
  const result = evaluateAiResponse({ ...s, expectedFacts: [{ path: "/domains/strength/data/invented", value: 70, kind: "REGISTERED_FACT" }] });
  assert.equal(result.passed, false);
  assert.deepEqual(result.counts.contextCoverage, { expected: 1, used: 0 });
});

test("AI-EVAL unrelated uncertainty cannot excuse an invented PR or active plan", () => {
  const response = { content: "Nao tenho dados de sono. Seu PR vitalicio foi 70 kg. Seu plano ativo e Upper A." };
  const result = evaluateAiResponse({ context: context(), response });
  assert.equal(result.passed, false);
  assert.ok(result.findings.some((f) => f.code === "lifetime_record_without_source"));
  assert.ok(result.findings.some((f) => f.code === "active_plan_without_source"));
  response.content = "Nao tenho seu PR vitalicio. Seu plano ativo esta indisponivel.";
  assert.equal(evaluateAiResponse({ context: context(), response }).passed, true);
});
