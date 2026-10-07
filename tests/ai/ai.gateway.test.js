const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiGateway, TASKS } = require("../../src/modules/ai/gateway/gateway");
const { createAiConfig } = require("../../src/modules/ai/gateway/config");
const { createOpenAIAdapter, createOpenRouterAdapter } = require("../../src/modules/ai/gateway/providers");
const { projection, validateWorkoutCatalog } = require("../../src/modules/ai/gateway/catalog");

const input = { objetivo: "hipertrofia", divisao: "ABC", nivel: "iniciante", diasPorSemana: 3,
  tempoPorTreino: 45, local: "academia", equipamentos: ["halteres"], restricoes: [], prioridades: [], minExerciciosPorDia: 6 };
const config = createAiConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "fixture-private-value",
  AI_PRIMARY_MODEL: "fixture/primary", AI_FALLBACK_MODELS: "fixture/fallback,fixture/third" });
function workout() {
  const names = ["Supino reto", "Remada curvada", "Elevacao lateral", "Triceps corda", "Puxada frontal", "Prancha frontal plank"];
  return { id: "plan-fixed", nome: "Treino", descricao: "Plano valido", objetivo: "hipertrofia", nivel: "iniciante",
    tempoEstimado: 45, criadoPorIA: true, dataCriacao: "2026-10-06T12:00:00.000Z",
    dias: [{ id: "day-fixed", nome: "Dia A", titulo: "Superior", diaSemana: "Segunda",
      exercicios: names.map((nome, i) => ({ id: `occurrence-${i}`, nome, categoria: "Superior", musculos: ["Superior"],
        equipamentos: ["Halteres"], series: 3, repeticoes: "8-12", descanso: 90 })) }], exercicios: [] };
}
function success(model = config.primaryModel, payload = workout()) {
  return { provider: "openrouter", model, content: JSON.stringify(payload), usage: { inputTokens: 100, outputTokens: 50 }, finishReason: "stop" };
}
function harness(outcomes, overrides = {}) {
  const calls = [], events = [];
  const adapter = { generate: async (request) => {
    calls.push(request);
    const result = outcomes.shift();
    if (result instanceof Error) throw result;
    return typeof result === "function" ? result(request) : result;
  } };
  const gateway = createAiGateway({ config: { ...config, ...overrides }, adapters: { openrouter: adapter }, logger: (event) => events.push(event) });
  return { calls, events, gateway, run: (extra = {}) => gateway.generate({ input, ...extra }) };
}
function failure(status) { return Object.assign(new Error("PRIVATE provider body fixture-private-value"), { status }); }

test("AI-GATEWAY-01/02: semantic task routes exclusively through injected adapter", async () => {
  const h = harness([success()]);
  const result = await h.run();
  assert.equal(h.calls[0].task, "generate_workout");
  assert.equal(h.calls[0].model, config.primaryModel);
  assert.equal(result.data.id, "plan-fixed");
  assert.equal(h.calls[0].responseFormat.type, "json_schema");
  assert.match(h.calls[0].messages[1].content, /Nomes permitidos/);
});
test("AI-GATEWAY-03: reserved/unknown tasks call zero providers", async () => {
  const h = harness([]);
  for (const task of [...Object.keys(TASKS).filter((t) => TASKS[t] === "reserved"), "unknown"]) {
    await assert.rejects(h.run({ task }), { code: "ai_unsupported_task" });
  }
  assert.equal(h.calls.length, 0);
});
test("AI-GATEWAY-04: explicit missing key/model fails closed; legacy remains compatible", async () => {
  const h = harness([], { apiKey: "" });
  await assert.rejects(h.run(), { code: "ai_not_configured" });
  assert.equal(h.calls.length, 0);
  assert.equal(createAiConfig({ OPENAI_MODEL: "legacy" }).primaryModel, "legacy");
  assert.throws(() => createAiConfig({ AI_PROVIDER: "client-injection" }));
  assert.throws(() => createAiConfig({ AI_MAX_ATTEMPTS: "99" }));
});
test("AI-FALLBACK-01: successful primary never calls fallback", async () => {
  const h = harness([success(), success()]); await h.run(); assert.equal(h.calls.length, 1);
});
for (const [label, error] of [
  ["02 timeout", Object.assign(new Error("private"), { name: "APIConnectionTimeoutError" })],
  ["03 429", failure(429)], ["04 503", failure(503)], ["04 connection", Object.assign(new Error("private"), { code: "ECONNRESET" })]
]) test(`AI-FALLBACK-${label}: fallback succeeds`, async () => {
  const h = harness([error, success(config.fallbackModels[0])]);
  const result = await h.run(); assert.equal(h.calls.length, 2);
  assert.equal(result.metadata.fallbackUsed, true);
  assert.equal(result.metadata.servedModel, config.fallbackModels[0]);
});
test("AI-FALLBACK-05: exhausted routes expose a stable sanitized error", async () => {
  const h = harness([failure(503), failure(503), failure(503)]);
  await assert.rejects(h.run(), (error) => {
    assert.equal(error.code, "ai_provider_unavailable"); assert.equal(error.retryable, true);
    assert.equal(error.details, undefined); assert.doesNotMatch(error.message, /PRIVATE/); return true;
  });
  assert.equal(h.calls.length, 3);
});
test("AI-FALLBACK-06/07: explicit attempts bound routing and metadata", async () => {
  const h = harness([failure(503), failure(503), success()], { maxAttempts: 2 });
  await assert.rejects(h.run()); assert.equal(h.calls.length, 2);
  assert.equal(h.events[0].attemptCount, 2);
});
test("AI-FALLBACK: real deadline aborts a stalled adapter and allows fallback", async () => {
  let aborted = false;
  const h = harness([(req) => new Promise(() => req.signal.addEventListener("abort", () => { aborted = true; })), success(config.fallbackModels[0])],
    { timeoutMs: 5, totalTimeoutMs: 100, fallbackModels: [config.fallbackModels[0]] });
  await h.run(); assert.equal(aborted, true); assert.equal(h.calls.length, 2);
});
for (const status of [400, 401, 403, 404, 501]) test(`AI-SEC: provider ${status} is not retried`, async () => {
  const h = harness([failure(status), success()]); await assert.rejects(h.run()); assert.equal(h.calls.length, 1);
});
test("AI-VALID-01/02/05: malformed JSON and schema permit only one semantic fallback", async () => {
  for (const content of ["not-json PRIVATE", JSON.stringify({ nome: "incomplete" })]) {
    const h = harness([{ ...success(), content }, { ...success(), content }, success()]);
    await assert.rejects(h.run(), { code: "ai_invalid_response" }); assert.equal(h.calls.length, 2);
    const valid = harness([{ ...success(), content }, success(config.fallbackModels[0])]);
    assert.equal((await valid.run()).metadata.attemptCount, 2);
  }
});
test("AI-VALID-03: nonexistent/ambiguous exercises fail closed without fallback", async () => {
  for (const name of ["invented moon lift", "Prancha", "constructor", "__proto__", "Supino r\u0113to"]) {
    const invalid = workout(); invalid.dias[0].exercicios[0].nome = name;
    const h = harness([success(config.primaryModel, invalid), success()]);
    await assert.rejects(h.run(), { code: "ai_domain_validation_error" }); assert.equal(h.calls.length, 1);
  }
});
test("AI-VALID-04: generated projection preserves canonical identities and reviewed alias", () => {
  assert.equal(projection.canonicalIds.length, 362);
  assert.equal(projection.nameBindings["elevacao lateral"], "ombros_003");
  assert.equal(projection.contract, "ExerciseCatalogBindingContract/v1");
  const value = workout(); assert.equal(validateWorkoutCatalog(value), value);
  assert.equal(value.dias[0].exercicios[0].id, "occurrence-0");
});
test("AI-VALID: repeated canonical movement inside a day is domain invalid", async () => {
  const value = workout(); value.dias[0].exercicios[1].nome = "bench press";
  await assert.rejects(harness([success(config.primaryModel, value)]).run(), { code: "ai_domain_validation_error" });
  const duplicateId = workout(); duplicateId.dias[0].exercicios[1].id = duplicateId.dias[0].exercicios[0].id;
  await assert.rejects(harness([success(config.primaryModel, duplicateId)]).run(), { code: "ai_domain_validation_error" });
  const duplicateDay = workout(); duplicateDay.dias.push(duplicateDay.dias[0]);
  await assert.rejects(harness([success(config.primaryModel, duplicateDay)]).run(), { code: "ai_domain_validation_error" });
});
test("AI-SEC-01/02 + AI-OBS-01..06: safe allowlisted metadata, no prompt/key/JWT/body", async () => {
  const h = harness([success()]);
  const result = await h.run({ input: { ...input, observacoes: "private-personal-observation" }, requestId: "Bearer private-correlation" });
  assert.match(result.metadata.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(h.events[0]).sort(), ["event", "requestId", "taskType", "provider", "policy", "servedModel",
    "fallbackUsed", "attemptCount", "latencyMs", "inputTokens", "outputTokens", "estimatedCost", "status", "errorCategory"].sort());
  assert.equal(result.metadata.inputTokens, 100); assert.equal(result.metadata.outputTokens, 50);
  assert.equal(result.metadata.estimatedCost, "unavailable"); assert.ok(result.metadata.latencyMs >= 0);
  assert.doesNotMatch(JSON.stringify(h.events), /fixture-private-value|private-personal-observation|Bearer/);
});
test("AI-OBS: malformed/missing usage and untrusted model are not logged", async () => {
  const h = harness([{ ...success(), model: "fixture-private-value", usage: { inputTokens: -1, outputTokens: "secret" } }]);
  const { metadata } = await h.run();
  assert.equal(metadata.servedModel, null); assert.equal(metadata.inputTokens, null); assert.equal(metadata.outputTokens, null);
  assert.doesNotMatch(JSON.stringify(h.events), /fixture-private-value/);
});
test("AI-SEC-01: provider credential embedded in valid JSON is never returned", async () => {
  const leaked = workout(); leaked.descricao = config.apiKey;
  for (const content of [JSON.stringify(leaked), JSON.stringify(leaked).replace(config.apiKey,
    [...config.apiKey].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""))]) {
    const h = harness([{ ...success(), content }], { semanticFallbacks: 0 });
    await assert.rejects(h.run(), (error) => {
      assert.equal(error.code, "ai_invalid_response");
      assert.doesNotMatch(JSON.stringify(error), /fixture-private-value/); return true;
    });
    assert.doesNotMatch(JSON.stringify(h.events), /fixture-private-value/);
  }
});
test("AI-OBS: tokens from invalid primary and valid fallback are accumulated", async () => {
  const h = harness([{ ...success(), content: "invalid" }, success(config.fallbackModels[0])]);
  assert.equal((await h.run()).metadata.inputTokens, 200);
});
test("AI-OBS: telemetry failure cannot retry a successful generation", async () => {
  let calls = 0;
  const gateway = createAiGateway({ config, adapters: { openrouter: { generate: async () => { calls++; return success(); } } },
    logger: () => { throw new Error("log failure"); } });
  assert.equal((await gateway.generate({ input })).data.id, "plan-fixed"); assert.equal(calls, 1);
});
test("OpenRouter adapter: server-only key, one model, strict schema, no hidden retries", async () => {
  let captured;
  const adapter = createOpenRouterAdapter(config, { fetchImpl: async (url, options) => {
    captured = { url, options }; return new Response(JSON.stringify({ model: config.primaryModel,
      choices: [{ message: { content: JSON.stringify(workout()) }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  } });
  const normalized = await adapter.generate({ model: config.primaryModel, messages: [], responseFormat: { type: "json_schema", name: "fitia", strict: true, schema: {} } });
  const body = JSON.parse(captured.options.body);
  assert.equal(body.provider.allow_fallbacks, false); assert.equal(body.provider.require_parameters, true);
  assert.equal(body.provider.data_collection, "deny"); assert.equal(body.models, undefined);
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(captured.options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.equal(normalized.usage.inputTokens, 20); assert.equal(normalized.structuredPayload.id, "plan-fixed");
});
test("OpenRouter adapter: HTTP 200 embedded error and invalid envelope are failures", async () => {
  for (const [body, expected] of [[JSON.stringify({ error: { code: 503, message: "private" } }), { status: 503 }],
    ["not-json", { name: "InvalidProviderResponse" }], ["null", { name: "InvalidProviderResponse" }]]) {
    const adapter = createOpenRouterAdapter(config, { fetchImpl: async () => new Response(body) });
    await assert.rejects(adapter.generate({ responseFormat: { type: "json_schema" } }), expected);
  }
});
test("OpenAI adapter: Responses format, no SDK retry, abort and no stored response", async () => {
  let captured;
  const adapter = createOpenAIAdapter(config, { client: { responses: { create: async (...args) => {
    captured = args; return { model: config.primaryModel, output_text: JSON.stringify(workout()), status: "completed", usage: { input_tokens: 10, output_tokens: 5 } };
  } } } });
  await adapter.generate({ model: config.primaryModel, messages: [], responseFormat: {}, signal: new AbortController().signal, timeoutMs: 100 });
  assert.equal(captured[1].maxRetries, 0); assert.equal(captured[0].store, false); assert.ok(captured[1].signal);
});

module.exports = { input, workout, success, config };
