const { createHash } = require("node:crypto");
const prisma = require("../../config/prisma");
const env = require("../../config/env");
const AppError = require("../../shared/errors/app-error");

const AI_OPERATIONS = Object.freeze({
  workout: "workout_generation",
  coach: "coach_insights",
  chat: "chat_message"
});

function readIdempotencyKey(req) {
  const key = String(req.get("Idempotency-Key") || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) {
    throw new AppError(
      "Idempotency-Key valido e obrigatorio para esta operacao.",
      400,
      "invalid_idempotency_key"
    );
  }
  return key;
}

async function claimAiUsage({ userId, operation, idempotencyKey, input }) {
  const requestHash = hashPayload(input);
  const periodStart = currentPeriodStart();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => claimWithinTransaction({
        tx, userId, operation, idempotencyKey, requestHash, periodStart
      }), { isolationLevel: "Serializable" });
    } catch (error) {
      if (error && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("Nao foi possivel reservar o uso de IA.");
}

async function claimWithinTransaction({ tx, userId, operation, idempotencyKey, requestHash, periodStart }) {
    const existing = await tx.aiUsage.findUnique({
      where: {
        userId_operation_idempotencyKey: { userId, operation, idempotencyKey }
      }
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          "A chave de idempotencia ja foi usada com outra solicitacao.",
          409,
          "idempotency_key_reused"
        );
      }
      if (existing.status === "succeeded" && existing.response) {
        return { kind: "replay", usage: existing, response: existing.response };
      }
      const staleChat = operation === AI_OPERATIONS.chat && existing.status === "pending" &&
        existing.updatedAt && Date.now() - existing.updatedAt.getTime() > 120000;
      if (existing.status === "pending" && !staleChat) {
        throw new AppError(
          "Esta solicitacao de IA ainda esta sendo processada.",
          409,
          "ai_request_in_progress"
        );
      }
      if (staleChat) {
        await tx.aiUsage.update({ where: { id: existing.id }, data: { status: "failed", errorCode: "ai_chat_lease_expired" } });
      }
    }

    const quota = quotaFor(operation);
    const used = await tx.aiUsage.count({
      where: {
        userId,
        operation,
        periodStart,
        status: { in: ["pending", "succeeded"] }
      }
    });
    if (used >= quota) {
      throw new AppError(
        "Limite diario desta funcionalidade de IA atingido.",
        429,
        "ai_quota_exceeded",
        { operation, retryAfter: nextPeriodStart(periodStart).toISOString() }
      );
    }

    // A failed operation can be reclaimed, but never bypass today's quota.
    if (existing) {
      const retried = await tx.aiUsage.update({
        where: { id: existing.id },
        data: { status: "pending", errorCode: null, completedAt: null, periodStart }
      });
      return { kind: "claimed", usage: retried };
    }

    const usage = await tx.aiUsage.create({
      data: { userId, operation, idempotencyKey, requestHash, periodStart }
    });
    return { kind: "claimed", usage };
}

async function completeAiUsage(usageId, response) {
  await prisma.aiUsage.update({
    where: { id: usageId },
    data: { status: "succeeded", response, completedAt: new Date(), errorCode: null }
  });
}

async function failAiUsage(usageId, error) {
  await prisma.aiUsage.updateMany({
    where: { id: usageId, status: "pending" },
    data: {
      status: "failed",
      errorCode: sanitizeErrorCode(error),
      completedAt: new Date()
    }
  });
}

function quotaFor(operation) {
  if (operation === AI_OPERATIONS.workout) return env.aiWorkoutDailyQuota;
  if (operation === AI_OPERATIONS.coach || operation === AI_OPERATIONS.chat) return env.aiCoachDailyQuota;
  throw new Error(`Operacao de IA desconhecida: ${operation}`);
}

function currentPeriodStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nextPeriodStart(periodStart) {
  return new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
}

function hashPayload(payload) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sanitizeErrorCode(error) {
  const code = String(error && error.code ? error.code : "ai_generation_failed");
  return /^[a-z0-9_:-]{1,80}$/i.test(code) ? code : "ai_generation_failed";
}

module.exports = {
  AI_OPERATIONS,
  readIdempotencyKey,
  claimAiUsage,
  completeAiUsage,
  failAiUsage,
  quotaFor,
  currentPeriodStart,
  hashPayload,
  claimWithinTransaction
};
