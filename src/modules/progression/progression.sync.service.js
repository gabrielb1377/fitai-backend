const prisma = require("../../config/prisma");
const {
  parseProgressionSyncEvent,
  formatZodIssues
} = require("./progression.sync.schemas");
const {
  CONTRACT_VERSION,
  RULES_VERSION,
  xpForSource,
  balanceForTotalXp
} = require("./progression.sync.rules");

function createProgressionSyncService({ prismaClient = prisma, now = () => new Date() } = {}) {
  async function processBatch({
    userId,
    deviceId,
    contractVersion,
    rulesVersion,
    afterRevision = "0",
    events
  }) {
    const ack = { accepted: [], alreadyApplied: [], rejected: [] };

    for (const rawEvent of events) {
      const parsed = parseProgressionSyncEvent(rawEvent);
      if (!parsed.success) {
        ack.rejected.push(rejected(
          rawEvent && rawEvent.eventId,
          "invalid_progression_event",
          "Evento de progressao invalido.",
          formatZodIssues(parsed.error)
        ));
        continue;
      }

      const event = parsed.data;
      if (rulesVersion !== RULES_VERSION || event.rulesVersion !== RULES_VERSION) {
        ack.rejected.push(rejected(
          event.eventId,
          "unsupported_rules_version",
          `Rules version suportada: ${RULES_VERSION}.`
        ));
        continue;
      }

      const result = await processEvent({ userId, deviceId, event });
      ack[result.bucket].push(result.data);
    }

    return {
      contractVersion,
      rulesVersion: RULES_VERSION,
      ack,
      state: await pullState({ userId, afterRevision })
    };
  }

  async function processEvent({ userId, deviceId, event }) {
    const existing = await findExisting(prismaClient, userId, event);
    if (existing) return duplicateOutcome(existing, event);

    const xpAwarded = xpForSource(event.sourceType, event.rulesVersion);
    if (!xpAwarded) {
      return {
        bucket: "rejected",
        data: rejected(event.eventId, "unsupported_progression_source", "Origem de XP nao suportada.")
      };
    }

    try {
      const created = await prismaClient.$transaction(async (tx) => {
        const source = await validateSource(tx, userId, event);
        if (!source.valid) return source;

        const record = await tx.progressionXpEvent.create({
          data: {
            userId,
            deviceId,
            eventId: event.eventId,
            idempotencyKey: semanticIdentity(userId, event),
            sourceType: event.sourceType,
            sourceId: event.sourceId,
            rulesVersion: event.rulesVersion,
            xpAwarded,
            occurredAt: event.occurredAt,
            processedAt: now()
          }
        });
        return { valid: true, record };
      });

      if (!created.valid) {
        return {
          bucket: "rejected",
          data: rejected(event.eventId, created.code, created.message)
        };
      }

      return { bucket: "accepted", data: acknowledgement(created.record) };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await findExisting(prismaClient, userId, event);
      if (raced) return duplicateOutcome(raced, event);
      throw error;
    }
  }

  async function pullState({ userId, afterRevision = "0" }) {
    const cursor = parseRevision(afterRevision);
    const records = await prismaClient.progressionXpEvent.findMany({
      where: { userId },
      orderBy: { revision: "asc" }
    });
    const latest = records.length > 0 ? BigInt(records[records.length - 1].revision) : 0n;
    const totalXp = records.reduce((total, event) => total + event.xpAwarded, 0);

    return {
      revision: latest.toString(),
      balance: balanceForTotalXp(totalXp),
      events: records
        .filter((event) => BigInt(event.revision) > cursor)
        .map(toRemoteEvent)
    };
  }

  return { processBatch, processEvent, pullState };
}

async function validateSource(tx, userId, event) {
  if (event.sourceType === "workout") {
    const session = await tx.workoutSyncSession.findUnique({
      where: {
        userId_externalSessionId: {
          userId,
          externalSessionId: event.sourceId
        }
      }
    });
    if (session) {
      return session.status === "completed"
        ? { valid: true }
        : invalidSource("source_not_completed", "O treino ainda nao foi concluido no servidor.");
    }

    const history = await tx.workoutHistory.findFirst({
      where: { id: event.sourceId, userId }
    });
    return history
      ? { valid: true }
      : invalidSource("source_not_found", "Treino concluido ainda nao encontrado para este usuario.");
  }

  if (event.sourceType === "running") {
    const run = await tx.runningHistory.findFirst({
      where: {
        userId,
        deletedAt: null,
        OR: [{ id: event.sourceId }, { externalRunId: event.sourceId }]
      }
    });
    return run
      ? { valid: true }
      : invalidSource("source_not_found", "Corrida concluida ainda nao encontrada para este usuario.");
  }

  if (event.sourceType === "stepsGoal") {
    const date = dateFromSourceId(event.sourceId);
    if (!date) return invalidSource("invalid_source_id", "Data da meta de passos invalida.");
    const steps = await tx.dailySteps.findUnique({
      where: { userId_dayKey: { userId, dayKey: event.sourceId } }
    });
    if (!steps) {
      return invalidSource("source_not_found", "Registro de passos ainda nao encontrado para este usuario.");
    }
    return steps.goal > 0 && steps.steps >= steps.goal
      ? { valid: true }
      : invalidSource("source_not_completed", "A meta de passos ainda nao foi atingida no servidor.");
  }

  return invalidSource("unsupported_progression_source", "Origem de XP nao suportada.");
}

async function findExisting(client, userId, event) {
  const byEventId = await client.progressionXpEvent.findUnique({
    where: { userId_eventId: { userId, eventId: event.eventId } }
  });
  if (byEventId) return byEventId;
  return client.progressionXpEvent.findUnique({
    where: {
      userId_sourceType_sourceId: {
        userId,
        sourceType: event.sourceType,
        sourceId: event.sourceId
      }
    }
  });
}

function duplicateOutcome(existing, event) {
  if (existing.sourceType !== event.sourceType || existing.sourceId !== event.sourceId) {
    return {
      bucket: "rejected",
      data: rejected(event.eventId, "event_id_conflict", "Event ID ja utilizado por outra origem.")
    };
  }
  return { bucket: "alreadyApplied", data: acknowledgement(existing, event.eventId) };
}

function acknowledgement(record, requestedEventId = record.eventId) {
  return {
    eventId: requestedEventId,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    xpAwarded: record.xpAwarded,
    rulesVersion: record.rulesVersion,
    revision: BigInt(record.revision).toString(),
    processedAt: record.processedAt.toISOString()
  };
}

function toRemoteEvent(record) {
  return {
    eventId: record.eventId,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    xpAwarded: record.xpAwarded,
    rulesVersion: record.rulesVersion,
    occurredAt: record.occurredAt.toISOString(),
    processedAt: record.processedAt.toISOString(),
    revision: BigInt(record.revision).toString()
  };
}

function semanticIdentity(userId, event) {
  return `${userId}:${event.sourceType}:${event.sourceId}`;
}

function invalidSource(code, message) {
  return { valid: false, code, message };
}

function rejected(eventId, code, message, details = undefined) {
  return {
    eventId: String(eventId || "unknown"),
    code,
    message,
    ...(details ? { details } : {})
  };
}

function dateFromSourceId(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRevision(value) {
  try {
    const revision = BigInt(value || "0");
    return revision < 0n ? 0n : revision;
  } catch (_) {
    return 0n;
  }
}

function isUniqueConstraintError(error) {
  return Boolean(error && error.code === "P2002");
}

module.exports = {
  createProgressionSyncService,
  semanticIdentity,
  ...createProgressionSyncService(),
  CONTRACT_VERSION,
  RULES_VERSION
};
