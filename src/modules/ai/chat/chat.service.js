const { randomUUID } = require("node:crypto");
const prisma = require("../../../config/prisma");
const AppError = require("../../../shared/errors/app-error");
const usage = require("../ai-usage.service");
const { createAiGateway } = require("../gateway/gateway");
const { createAiConfig } = require("../gateway/config");
const { createFitnessContextEngine } = require("./fitness-context.engine");
const { CHAT_VERSION, selectTask } = require("./chat.schema");

const HISTORY_MESSAGES = 8;
const HISTORY_CHARS = 6000;
const LEASE_MS = 120000;
const busy = () => new AppError("Esta conversa esta sendo processada. Tente novamente.", 409, "ai_request_in_progress");

function createChatService({ client = prisma, contextEngine = createFitnessContextEngine({ client }),
  gateway = createAiGateway({ config: createAiConfig() }), claim = usage.claimAiUsage,
  fail = usage.failAiUsage, now = () => new Date() } = {}) {
  async function owned(userId, conversationId) {
    const conversation = await client.aiConversation.findFirst({ where: { id: conversationId, userId } });
    if (!conversation) throw new AppError("Conversa nao encontrada.", 404, "conversation_not_found");
    return conversation;
  }
  async function transaction(action) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await client.$transaction(action, { isolationLevel: "Serializable" }); }
      catch (error) { if (error.code === "P2034" && attempt < 2) continue; throw error; }
    }
  }
  async function prepare(userId, input, usageId) {
    return transaction(async (tx) => {
      let c;
      if (input.conversationId) c = await tx.aiConversation.findFirst({ where: { id: input.conversationId, userId } });
      else c = await tx.aiConversation.upsert({ where: { initialUsageId: usageId }, update: {},
        create: { userId, initialUsageId: usageId } });
      if (!c || c.userId !== userId) throw new AppError("Conversa nao encontrada.", 404, "conversation_not_found");
      const locked = await tx.aiConversation.updateMany({ where: { id: c.id, userId, lockVersion: c.lockVersion,
        OR: [{ pendingUsageId: null }, { pendingUntil: { lt: now() } }] },
        data: { pendingUsageId: usageId, pendingUntil: new Date(+now() + LEASE_MS), lockVersion: { increment: 1 } } });
      if (locked.count !== 1) throw busy();
      const recent = await tx.aiChatMessage.findMany({ where: { conversationId: c.id },
        orderBy: { sequence: "desc" }, take: HISTORY_MESSAGES,
        select: { role: true, content: true, taskType: true } });
      const history = recent.reverse();
      const previousTask = history.at(-1)?.taskType;
      while (history.reduce((n, m) => n + m.content.length, 0) > HISTORY_CHARS) history.splice(0, 2);
      return { conversationId: c.id, sequence: c.nextSequence, lockVersion: c.lockVersion + 1,
        task: selectTask(input, previousTask), history };
    });
  }
  async function send({ userId, input }) {
    if (input.conversationId) await owned(userId, input.conversationId);
    const result = await claim({ userId, operation: usage.AI_OPERATIONS.chat,
      idempotencyKey: input.clientRequestId, input });
    if (result.kind === "replay") return { response: result.response, replay: true };
    const usageId = result.usage.id;
    let lease;
    try {
      lease = await prepare(userId, input, usageId);
      const context = await contextEngine.build({ userId, task: lease.task });
      const answer = await gateway.generate({ task: lease.task, requestId: usageId,
        input: { message: input.message, context, history: lease.history } });
      const createdAt = now();
      const response = { contractVersion: CHAT_VERSION, conversationId: lease.conversationId,
        clientRequestId: input.clientRequestId, userMessageId: randomUUID(), messageId: randomUUID(),
        content: answer.data.content, taskType: lease.task, requestId: usageId,
        contextSummary: Object.fromEntries(Object.entries(context.domains).map(([k, v]) => [k, v.status])),
        capabilities: [], createdAt: createdAt.toISOString() };
      await transaction(async (tx) => {
        const released = await tx.aiConversation.updateMany({ where: { id: lease.conversationId, userId,
          lockVersion: lease.lockVersion, pendingUsageId: usageId },
          data: { pendingUsageId: null, pendingUntil: null, nextSequence: { increment: 2 } } });
        if (released.count !== 1) throw busy();
        await tx.aiChatMessage.createMany({ data: [
          { id: response.userMessageId, conversationId: lease.conversationId, usageId, role: "user", content: input.message,
            taskType: lease.task, sequence: lease.sequence, createdAt },
          { id: response.messageId, conversationId: lease.conversationId, usageId, role: "assistant", content: response.content,
            taskType: lease.task, sequence: lease.sequence + 1, createdAt }
        ] });
        await tx.aiUsage.update({ where: { id: usageId }, data: { status: "succeeded", response, completedAt: createdAt, errorCode: null } });
      });
      return { response, replay: false };
    } catch (error) {
      if (lease) {
        await transaction(async (tx) => {
          const released = await tx.aiConversation.updateMany({ where: { id: lease.conversationId, userId,
            lockVersion: lease.lockVersion, pendingUsageId: usageId }, data: { pendingUsageId: null, pendingUntil: null } });
          if (released.count) await tx.aiUsage.updateMany({ where: { id: usageId, status: "pending" },
            data: { status: "failed", completedAt: now(), errorCode: /^[a-z_]{1,80}$/.test(error.code) ? error.code : "ai_chat_unavailable" } });
        });
      } else await fail(usageId, error);
      throw error;
    }
  }
  async function history({ userId, conversationId }) {
    await owned(userId, conversationId);
    const messages = await client.aiChatMessage.findMany({ where: { conversationId }, orderBy: { sequence: "desc" }, take: 40,
      select: { id: true, role: true, content: true, taskType: true, createdAt: true } });
    return { contractVersion: CHAT_VERSION, conversationId, messages: messages.reverse() };
  }
  return { send, history };
}
module.exports = { createChatService, HISTORY_MESSAGES, HISTORY_CHARS, LEASE_MS };
