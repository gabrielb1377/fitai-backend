const { createHash } = require("crypto");
const prisma = require("../../config/prisma");
const AppError = require("../../shared/errors/app-error");
const {
  parseWorkoutSyncEvent,
  formatZodIssues
} = require("./workout_sync.schemas");

function createWorkoutSyncService({ prismaClient = prisma, now = () => new Date() } = {}) {
  async function processBatch({ userId, deviceId, events }) {
    const result = {
      accepted: [],
      alreadyProcessed: [],
      conflicts: [],
      rejected: []
    };
    const startedAt = Date.now();

    for (const rawEvent of events) {
      const validation = parseWorkoutSyncEvent(rawEvent);
      const fallbackEventId = safeText(rawEvent && rawEvent.eventId, "unknown-event");

      if (!validation.success) {
        result.rejected.push(rejected(fallbackEventId, "invalid_event", "Evento invalido.", formatZodIssues(validation.error)));
        continue;
      }

      try {
        const outcome = await processEvent({
          userId,
          deviceId,
          event: validation.data
        });
        result[outcome.bucket].push(outcome.data);
      } catch (error) {
        const outcome = classifyError(validation.data.eventId, error);
        result[outcome.bucket].push(outcome.data);
      }
    }

    log({
      action: "batch_processed",
      userId,
      deviceId,
      eventCount: events.length,
      accepted: result.accepted.length,
      alreadyProcessed: result.alreadyProcessed.length,
      conflicts: result.conflicts.length,
      rejected: result.rejected.length,
      durationMs: Date.now() - startedAt
    });

    return result;
  }

  async function processEvent({ userId, deviceId, event }) {
    try {
      return await prismaClient.$transaction(async (tx) => {
        const existing = await tx.workoutSyncEvent.findFirst({
          where: {
            userId,
            OR: [
              { idempotencyKey: event.idempotencyKey },
              { eventId: event.eventId }
            ]
          }
        });

        if (existing) {
          return duplicateOutcome(existing, event);
        }

        return applyEvent(tx, { userId, deviceId, event });
      });
    } catch (error) {
      if (error && error.code === "P2002") {
        const existing = await prismaClient.workoutSyncEvent.findFirst({
          where: {
            userId,
            OR: [
              { idempotencyKey: event.idempotencyKey },
              { eventId: event.eventId }
            ]
          }
        });
        if (existing) return duplicateOutcome(existing, event);
      }
      throw error;
    }
  }

  async function applyEvent(tx, { userId, deviceId, event }) {
    const outcome = await eventHandler(tx, { userId, deviceId, event });

    if (outcome.bucket === "conflicts") {
      await recordEvent(tx, { userId, deviceId, event, status: "conflict", error: outcome.data.reason });
      return outcome;
    }

    await recordEvent(tx, {
      userId,
      deviceId,
      event,
      status: outcome.bucket === "alreadyProcessed" ? "already_processed" : "processed"
    });
    return outcome;
  }

  async function eventHandler(tx, context) {
    switch (context.event.eventType) {
      case "workout_session_started":
        return applySessionStarted(tx, context);
      case "workout_set_completed":
        return applySetCompleted(tx, context);
      case "workout_session_paused":
      case "workout_session_resumed":
      case "workout_session_finished":
      case "workout_session_discarded":
        return applySessionTransition(tx, context);
      default:
        throw new AppError("Evento de treino nao suportado.", 400, "unsupported_workout_event");
    }
  }

  async function applySessionStarted(tx, { userId, event }) {
    const session = readSession(event);
    if (session.externalSessionId !== event.aggregateId) {
      return conflict(event, "aggregate_session_mismatch", "aggregateId nao corresponde a sessao.");
    }

    const existing = await tx.workoutSyncSession.findUnique({
      where: { userId_externalSessionId: { userId, externalSessionId: session.externalSessionId } }
    });

    if (existing) {
      if (sameSessionStart(existing, session)) {
        return alreadyProcessed(event, existing.version);
      }
      return conflict(event, "session_already_exists", "Sessao existente possui dados divergentes.", existing.version);
    }

    const created = await tx.workoutSyncSession.create({
      data: {
        userId,
        externalSessionId: session.externalSessionId,
        planId: session.planId,
        workoutId: session.workoutId,
        status: "active",
        startedAt: session.startedAt,
        currentExerciseIndex: session.currentExerciseIndex,
        currentSetIndex: session.currentSetIndex,
        restEndsAt: session.restEndsAt,
        version: event.version
      }
    });

    return accepted(event, created.version);
  }

  async function applySetCompleted(tx, { userId, event }) {
    const set = readSet(event);
    const session = await tx.workoutSyncSession.findUnique({
      where: { userId_externalSessionId: { userId, externalSessionId: set.externalSessionId } }
    });

    if (!session) {
      throw new AppError("Sessao de treino nao encontrada.", 409, "workout_session_not_found");
    }
    if (session.status === "completed" || session.status === "discarded") {
      return conflict(event, "session_closed", "Sessao ja foi encerrada.", session.version);
    }

    const sameSetId = await tx.workoutSyncSet.findUnique({
      where: { userId_externalSetId: { userId, externalSetId: set.externalSetId } }
    });
    if (sameSetId) {
      if (sameSet(sameSetId, set, session.id)) return alreadyProcessed(event, sameSetId.version);
      return conflict(event, "set_payload_conflict", "A serie possui conteudo divergente.", sameSetId.version);
    }

    const logicalSet = await tx.workoutSyncSet.findUnique({
      where: {
        sessionId_exerciseId_setIndex: {
          sessionId: session.id,
          exerciseId: set.exerciseId,
          setIndex: set.setIndex
        }
      }
    });
    if (logicalSet) {
      if (sameSet(logicalSet, set)) return alreadyProcessed(event, logicalSet.version);
      return conflict(event, "logical_set_conflict", "A serie logica ja existe com dados divergentes.", logicalSet.version);
    }

    const created = await tx.workoutSyncSet.create({
      data: {
        userId,
        sessionId: session.id,
        externalSetId: set.externalSetId,
        exerciseId: set.exerciseId,
        setIndex: set.setIndex,
        weight: set.weight,
        reps: set.reps,
        completedAt: set.completedAt,
        version: event.version
      }
    });

    await tx.workoutSyncSession.update({
      where: { id: session.id },
      data: {
        currentSetIndex: Math.max(session.currentSetIndex, set.setIndex + 1),
        version: Math.max(session.version, event.version)
      }
    });
    return accepted(event, created.version);
  }

  async function applySessionTransition(tx, { userId, event }) {
    const sessionData = readSession(event);
    const session = await tx.workoutSyncSession.findUnique({
      where: { userId_externalSessionId: { userId, externalSessionId: sessionData.externalSessionId } }
    });
    if (!session) throw new AppError("Sessao de treino nao encontrada.", 409, "workout_session_not_found");
    if (event.version < session.version) {
      return conflict(event, "stale_version", "Versao da sessao esta desatualizada.", session.version);
    }

    const statusByEvent = {
      workout_session_paused: "paused",
      workout_session_resumed: "active",
      workout_session_finished: "completed",
      workout_session_discarded: "discarded"
    };
    const targetStatus = statusByEvent[event.eventType];
    if (session.status === targetStatus) return alreadyProcessed(event, session.version);
    if (["completed", "discarded"].includes(session.status)) {
      return conflict(event, "session_closed", "Sessao ja foi encerrada.", session.version);
    }

    const updated = await tx.workoutSyncSession.update({
      where: { id: session.id },
      data: {
        status: targetStatus,
        finishedAt: targetStatus === "completed" ? sessionData.finishedAt || event.occurredAt : null,
        currentExerciseIndex: sessionData.currentExerciseIndex,
        currentSetIndex: sessionData.currentSetIndex,
        restEndsAt: targetStatus === "active" ? sessionData.restEndsAt : null,
        version: event.version
      }
    });
    return accepted(event, updated.version);
  }

  async function recordEvent(tx, { userId, deviceId, event, status, error = null }) {
    return tx.workoutSyncEvent.create({
      data: {
        userId,
        deviceId,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
        payloadHash: fingerprint(event),
        occurredAt: event.occurredAt,
        processedAt: now(),
        status,
        error,
        version: event.version
      }
    });
  }

  return { processBatch, processEvent };
}

function duplicateOutcome(existing, event) {
  if (existing.payloadHash === fingerprint(event) && existing.status !== "conflict") {
    return alreadyProcessed(event, existing.version);
  }
  return conflict(event, "idempotency_key_conflict", "Chave de idempotencia reutilizada com dados divergentes.", existing.version);
}

function accepted(event, serverVersion) {
  return {
    bucket: "accepted",
    data: acknowledgement(event.eventId, serverVersion)
  };
}

function alreadyProcessed(event, serverVersion) {
  return {
    bucket: "alreadyProcessed",
    data: acknowledgement(event.eventId, serverVersion)
  };
}

function conflict(event, reason, message, serverVersion = null) {
  return {
    bucket: "conflicts",
    data: {
      eventId: event.eventId,
      reason,
      message,
      serverVersion
    }
  };
}

function rejected(eventId, code, message, details = undefined) {
  return { eventId, code, message, details };
}

function acknowledgement(eventId, serverVersion) {
  return {
    eventId,
    serverVersion,
    processedAt: new Date().toISOString()
  };
}

function classifyError(eventId, error) {
  if (error instanceof AppError) {
    if (error.statusCode === 409) {
      return {
        bucket: "conflicts",
        data: {
          eventId,
          reason: error.code,
          message: error.message,
          serverVersion: error.details && error.details.serverVersion || null
        }
      };
    }
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return { bucket: "rejected", data: rejected(eventId, error.code, error.message, error.details) };
    }
  }
  throw error;
}

function readSession(event) {
  const raw = event.payload && event.payload.session;
  if (!raw || typeof raw !== "object") {
    throw new AppError("Payload de sessao ausente.", 400, "invalid_session_payload");
  }
  const externalSessionId = safeText(raw.id);
  const planId = safeText(raw.planId);
  const workoutId = safeText(raw.workoutId);
  if (!externalSessionId || !planId || !workoutId) {
    throw new AppError("Campos obrigatorios da sessao ausentes.", 400, "invalid_session_payload");
  }
  return {
    externalSessionId,
    planId,
    workoutId,
    startedAt: requiredDate(raw.startedAt, "startedAt"),
    finishedAt: optionalDate(raw.finishedAt),
    currentExerciseIndex: nonNegativeInteger(raw.currentExerciseIndex, "currentExerciseIndex"),
    currentSetIndex: nonNegativeInteger(raw.currentSetIndex, "currentSetIndex"),
    restEndsAt: optionalDate(raw.restEndsAt)
  };
}

function readSet(event) {
  const raw = event.payload && event.payload.set;
  if (!raw || typeof raw !== "object") {
    throw new AppError("Payload de serie ausente.", 400, "invalid_set_payload");
  }
  const externalSetId = safeText(raw.id);
  const externalSessionId = safeText(raw.sessionId);
  const exerciseId = safeText(raw.exerciseId);
  const weight = Number(raw.weight);
  const reps = Number(raw.reps);
  if (!externalSetId || !externalSessionId || !exerciseId || !Number.isFinite(weight) || weight < 0 || !Number.isInteger(reps) || reps <= 0) {
    throw new AppError("Campos obrigatorios da serie invalidos.", 400, "invalid_set_payload");
  }
  return {
    externalSetId,
    externalSessionId,
    exerciseId,
    setIndex: nonNegativeInteger(raw.setIndex, "setIndex"),
    weight,
    reps,
    completedAt: requiredDate(raw.completedAt, "completedAt")
  };
}

function sameSessionStart(existing, incoming) {
  return existing.planId === incoming.planId && existing.workoutId === incoming.workoutId && existing.startedAt.getTime() === incoming.startedAt.getTime();
}

function sameSet(existing, incoming, sessionId) {
  return existing.sessionId === sessionId && existing.exerciseId === incoming.exerciseId && existing.setIndex === incoming.setIndex && Number(existing.weight) === incoming.weight && existing.reps === incoming.reps && existing.completedAt.getTime() === incoming.completedAt.getTime();
}

function fingerprint(event) {
  return createHash("sha256")
    .update(stableJson({
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      version: event.version,
      payload: event.payload
    }))
    .digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requiredDate(value, field) {
  const parsed = optionalDate(value);
  if (!parsed) throw new AppError(`Data ${field} invalida.`, 400, "invalid_workout_timestamp");
  return parsed;
}

function optionalDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nonNegativeInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(`Campo ${field} invalido.`, 400, "invalid_workout_payload");
  }
  return parsed;
}

function safeText(value, fallback = "") {
  return value === undefined || value === null ? fallback : String(value).trim() || fallback;
}

function log(data) {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[workout-sync] ${JSON.stringify(data)}`);
  }
}

module.exports = {
  createWorkoutSyncService,
  ...createWorkoutSyncService()
};
