const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const env = require("../../src/config/env");
const { authenticateJWT } = require("../../src/modules/auth/auth.middleware");
const asyncHandler = require("../../src/shared/utils/async-handler");
const errorHandler = require("../../src/shared/middleware/error-handler.middleware");
const { createChatController } = require("../../src/modules/ai/chat/chat.controller");
const { createChatService } = require("../../src/modules/ai/chat/chat.service");
const { createAiGateway } = require("../../src/modules/ai/gateway/gateway");
const { createAiConfig } = require("../../src/modules/ai/gateway/config");
const { quotaFor, AI_OPERATIONS } = require("../../src/modules/ai/ai-usage.service");
const { memoryClient } = require("./chat.fixture");

async function harness(t, outcomes = []) {
  const db = memoryClient(), calls = [], logs = [], contextOwners = [];
  const gateway = createAiGateway({ config: createAiConfig({ AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "fixture-key",
    AI_PRIMARY_MODEL: "fixture/primary", AI_FALLBACK_MODELS: "fixture/fallback" }),
    logger: (e) => logs.push(e), adapters: { openrouter: { generate: async (r) => {
      calls.push(r); const result = outcomes.shift(); if (result instanceof Error) throw result;
      return { content: JSON.stringify(result || { content: "Considere manter a consistencia." }), model: r.model, finishReason: "stop" };
    } } } });
  const make = () => createChatService({ ...db, contextEngine: { build: async ({ userId, task }) => {
    contextOwners.push(userId); return { contractVersion: "FitnessContext/v1", task, domains: { steps: { status: "UNAVAILABLE" } } };
  } }, gateway });
  const service = make();
  const controller = createChatController(service);
  const app = express(); app.use(express.json());
  app.post("/ai/chat", authenticateJWT, asyncHandler(controller.send));
  app.get("/ai/chat/conversations/:conversationId", authenticateJWT, asyncHandler(controller.history)); app.use(errorHandler);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const token = (owner) => jwt.sign({ sub: owner, typ: "access" }, env.jwtSecret, { expiresIn: "5m" });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { ...db, service, make, calls, logs, contextOwners, async post(input = {}, owner = "user-a") {
    const r = await fetch(`${base}/ai/chat`, { method: "POST", headers: { "Content-Type": "application/json", ...(owner ? { Authorization: `Bearer ${token(owner)}` } : {}) },
      body: JSON.stringify({ contractVersion: "AiChatContract/v1", clientRequestId: randomUUID(), message: "Como foi minha corrida?", ...input }) });
    return { status: r.status, body: await r.json() };
  }, async get(id, owner = "user-a") {
    const r = await fetch(`${base}/ai/chat/conversations/${id}`, { headers: { Authorization: `Bearer ${token(owner)}` } });
    return { status: r.status, body: await r.json() };
  } };
}

test("AI-CHAT-01 JWT required before storage/provider", async (t) => {
  const h = await harness(t); assert.equal((await h.post({}, null)).status, 401); assert.equal(h.calls.length, 0); assert.equal(h.usages.length, 0);
});
test("AI-CHAT-02/03 stable conversation/message IDs and persistence after service restart", async (t) => {
  const h = await harness(t), first = await h.post({ clientRequestId: "request-0001" });
  assert.equal(first.status, 200); assert.match(first.body.conversationId, /^[\da-f-]{36}$/); assert.match(first.body.messageId, /^[\da-f-]{36}$/);
  const history = await h.make().history({ userId: "user-a", conversationId: first.body.conversationId });
  assert.deepEqual(history.messages.map((m) => m.id), [first.body.userMessageId, first.body.messageId]);
});
test("AI-CHAT-04 A/B ownership enforced for read and write", async (t) => {
  const h = await harness(t), first = await h.post();
  assert.equal((await h.get(first.body.conversationId, "user-b")).status, 404);
  assert.equal((await h.post({ conversationId: first.body.conversationId }, "user-b")).status, 404);
  assert.deepEqual(h.contextOwners, ["user-a"]); assert.equal(h.calls.length, 1);
});
test("AI-CHAT-05 bounded ordered history and task continuity", async (t) => {
  const h = await harness(t), first = await h.post({ message: "Como foi minha corrida?" });
  const id = first.body.conversationId;
  for (let i = 0; i < 6; i++) assert.equal((await h.post({ conversationId: id, message: `E comparando com a anterior ${i}?` })).status, 200);
  const last = h.calls.at(-1); assert.equal(last.task, "running_advice"); assert.equal(last.messages.length, 11);
  assert.equal(last.messages[2].role, "user"); assert.equal(last.messages.at(-2).role, "assistant");
});
test("AI-CHAT-06 new conversation excludes old messages", async (t) => {
  const h = await harness(t), a = await h.post({ message: "old-private-history" }), b = await h.post({ message: "new-conversation" });
  assert.notEqual(a.body.conversationId, b.body.conversationId); assert.doesNotMatch(JSON.stringify(h.calls.at(-1).messages), /old-private-history/);
});
test("AI-CHAT-07 fallback uses identical context and conversation", async (t) => {
  const h = await harness(t, [{ content: "Primeira resposta." }, Object.assign(new Error("private-provider-error"), { status: 503 }), { content: "Segunda resposta." }]);
  const a = await h.post(); const b = await h.post({ conversationId: a.body.conversationId, message: "E a anterior?" });
  assert.equal(b.status, 200); assert.equal(a.body.conversationId, b.body.conversationId);
  assert.deepEqual(h.calls[1].messages, h.calls[2].messages); assert.equal(h.messages.length, 4);
});
test("AI-CHAT-08 idempotent lost response retry and changed input conflict", async (t) => {
  const h = await harness(t), input = { clientRequestId: "request-replay", message: "Ola" };
  const a = await h.post(input), b = await h.post(input); assert.deepEqual(a.body, b.body);
  assert.equal(h.messages.length, 2); assert.equal(h.calls.length, 1);
  assert.equal((await h.post({ ...input, message: "different" })).status, 409);
});
test("AI-CHAT-09 quota counts logical message once across tasks/replay/fallback", async (t) => {
  const h = await harness(t, [Object.assign(new Error("private"), { status: 503 }), { content: "Resposta." }]);
  const a = await h.post({ clientRequestId: "request-quota" }); await h.post({ clientRequestId: "request-quota" });
  assert.equal(h.usages.length, 1); assert.equal(h.calls.length, 2);
  for (let i = 1; i < quotaFor(AI_OPERATIONS.chat); i++) h.usages.push({ userId: "user-a", operation: AI_OPERATIONS.chat,
    status: "succeeded", periodStart: h.usages[0].periodStart });
  assert.equal((await h.post({ intent: "analyze_progress", conversationId: a.body.conversationId })).status, 429);
});
test("AI-CHAT-10 sanitized provider error; failed retry retains new conversation identity", async (t) => {
  const h = await harness(t, [Object.assign(new Error("SECRET JWT GPS"), { status: 401 }), { content: "Ok." }]);
  const input = { clientRequestId: "retry-failed", message: "Oi" };
  const a = await h.post(input); assert.equal(a.status, 503); assert.doesNotMatch(JSON.stringify(a.body), /SECRET|JWT|GPS|fixture-key/);
  const id = h.conversations[0].id; const b = await h.post(input); assert.equal(b.status, 200); assert.equal(b.body.conversationId, id);
});
test("AI-CHAT-11 client cannot select provider/model/context/userId", async (t) => {
  const h = await harness(t); for (const injected of [{ model: "x" }, { provider: "x" }, { userId: "b" }, { context: {} }]) {
    assert.equal((await h.post(injected)).status, 400);
  } assert.equal(h.calls.length, 0);
});
test("AI-CHAT-12 read-only structural contract rejects mutations and completed-action claims", async (t) => {
  const h = await harness(t, [{ content: "Ja aumentei sua carga." }]);
  assert.equal((await h.post()).status, 502); assert.equal(h.messages.length, 0);
  assert.equal(Object.hasOwn(h.client, "workout"), false);
});
test("AI-PRIV-03/05 JWT absent and logs metadata-only", async (t) => {
  const h = await harness(t); await h.post({ message: "PRIVATE_CONVERSATION" });
  assert.doesNotMatch(JSON.stringify(h.calls), /Bearer|eyJ|user-a|fixture-key/);
  assert.doesNotMatch(JSON.stringify(h.logs), /PRIVATE_CONVERSATION|FitnessContext|steps|user-a|fixture-key/);
});
test("AI-CHAT configuration missing fails closed without fake reply", async (t) => {
  const h = await harness(t); const g = createAiGateway({ config: createAiConfig({}), logger: () => {} });
  await assert.rejects(g.generate({ task: "chat", input: {} }), { code: "ai_not_configured" });
  assert.equal(h.calls.length, 0);
});
test("AI-CHAT stalled operation is reclaimable after lease expiry", async (t) => {
  const h = await harness(t); const input = { contractVersion: "AiChatContract/v1", clientRequestId: "stale-request", message: "Oi" };
  const { hashPayload, currentPeriodStart } = require("../../src/modules/ai/ai-usage.service");
  h.usages.push({ id: randomUUID(), userId: "user-a", operation: AI_OPERATIONS.chat, idempotencyKey: input.clientRequestId,
    requestHash: hashPayload(input), status: "pending", periodStart: currentPeriodStart(), updatedAt: new Date(Date.now() - 130000) });
  const response = await h.post(input); assert.equal(response.status, 200); assert.equal(h.usages.length, 1); assert.equal(h.messages.length, 2);
});
