const prisma = require("../../config/prisma");
const { CONTRACT_VERSION } = require("./activity_sync.rules");
const { parseRun, parseSteps, formatZodIssues } = require("./activity_sync.schemas");

function createActivitySyncService({ prismaClient = prisma, now = () => new Date() } = {}) {
  async function processBatch({ userId, deviceId, afterRevision = "0", runs, steps }) {
    const ack = { accepted: [], alreadyApplied: [], updated: [], rejected: [] };
    for (const raw of runs) {
      const parsed = parseRun(raw);
      if (!parsed.success) {
        ack.rejected.push(rejection(raw?.mutationId, "run", "invalid_run", formatZodIssues(parsed.error)));
        continue;
      }
      const outcome = await processRun({ userId, deviceId, run: parsed.data });
      ack[outcome.bucket].push(outcome.data);
    }
    for (const raw of steps) {
      const parsed = parseSteps(raw);
      if (!parsed.success) {
        ack.rejected.push(rejection(raw?.mutationId, "steps", "invalid_steps", formatZodIssues(parsed.error)));
        continue;
      }
      const outcome = await processSteps({ userId, deviceId, steps: parsed.data });
      ack[outcome.bucket].push(outcome.data);
    }
    return {
      contractVersion: CONTRACT_VERSION,
      ack,
      state: await pullState({ userId, afterRevision })
    };
  }

  async function processRun({ userId, deviceId, run }) {
    const duplicate = await findMutation(prismaClient, userId, run.mutationId);
    if (duplicate) return duplicateAck(duplicate);

    const existing = await prismaClient.runningHistory.findUnique({
      where: { userId_externalRunId: { userId, externalRunId: run.runId } }
    });
    if (existing && !run.deletedAt && !sameRun(existing, run)) {
      return {
        bucket: "rejected",
        data: rejection(run.mutationId, "run", "immutable_run_conflict")
      };
    }

    try {
      const result = await prismaClient.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const raced = await findMutation(tx, userId, run.mutationId);
        if (raced) return { duplicate: raced };
        const current = await tx.runningHistory.findUnique({
          where: { userId_externalRunId: { userId, externalRunId: run.runId } }
        });
        if (current && !run.deletedAt && !sameRun(current, run)) {
          return { conflict: true };
        }

        const mutation = await tx.activitySyncMutation.create({
          data: {
            userId,
            deviceId,
            mutationId: run.mutationId,
            entityType: "run",
            entityKey: run.runId,
            operation: run.deletedAt ? "tombstone" : "create",
            processedAt: now()
          }
        });
        if (!current) {
          await tx.runningHistory.create({
            data: runData(userId, run, mutation.revision, now())
          });
        } else if (run.deletedAt && !current.deletedAt) {
          await tx.runningHistory.update({
            where: { id: current.id },
            data: { deletedAt: run.deletedAt, revision: mutation.revision }
          });
        }
        return {
          mutation,
          alreadyPresent: Boolean(current),
          updatedTombstone: Boolean(current && run.deletedAt && !current.deletedAt)
        };
      });
      if (result.duplicate) return duplicateAck(result.duplicate);
      if (result.conflict) {
        return { bucket: "rejected", data: rejection(run.mutationId, "run", "immutable_run_conflict") };
      }
      return {
        bucket: result.updatedTombstone
          ? "updated"
          : result.alreadyPresent
            ? "alreadyApplied"
            : "accepted",
        data: acknowledgement(result.mutation)
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await findMutation(prismaClient, userId, run.mutationId);
      if (raced) return duplicateAck(raced);
      const sameIdentity = await prismaClient.runningHistory.findUnique({
        where: { userId_externalRunId: { userId, externalRunId: run.runId } }
      });
      if (sameIdentity && sameRun(sameIdentity, run)) {
        return {
          bucket: "alreadyApplied",
          data: entityAcknowledgement(run.mutationId, "run", run.runId, sameIdentity.revision)
        };
      }
      throw error;
    }
  }

  async function processSteps({ userId, deviceId, steps }) {
    const duplicate = await findMutation(prismaClient, userId, steps.mutationId);
    if (duplicate) return duplicateAck(duplicate);
    try {
      const result = await prismaClient.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const raced = await findMutation(tx, userId, steps.mutationId);
        if (raced) return { duplicate: raced };
        const existing = await tx.dailySteps.findUnique({
          where: { userId_dayKey: { userId, dayKey: steps.dayKey } }
        });
        const mutation = await tx.activitySyncMutation.create({
          data: {
            userId,
            deviceId,
            mutationId: steps.mutationId,
            entityType: "steps",
            entityKey: steps.dayKey,
            operation: existing ? "correct" : "create",
            processedAt: now()
          }
        });
        const data = {
          steps: steps.steps,
          goal: steps.goal,
          source: steps.source,
          deviceId,
          observedAt: steps.observedAt,
          revision: mutation.revision
        };
        if (existing) {
          await tx.dailySteps.update({ where: { id: existing.id }, data });
        } else {
          await tx.dailySteps.create({
            data: {
              userId,
              dayKey: steps.dayKey,
              date: new Date(`${steps.dayKey}T00:00:00.000Z`),
              ...data
            }
          });
        }
        return { mutation, updated: Boolean(existing) };
      });
      if (result.duplicate) return duplicateAck(result.duplicate);
      return {
        bucket: result.updated ? "updated" : "accepted",
        data: acknowledgement(result.mutation)
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await findMutation(prismaClient, userId, steps.mutationId);
      if (raced) return duplicateAck(raced);
      throw error;
    }
  }

  async function pullState({ userId, afterRevision = "0" }) {
    const cursor = BigInt(afterRevision);
    return prismaClient.$transaction(async (tx) => {
      // The same account lock used by writes prevents a cursor from advancing
      // past an uncommitted lower revision or a concurrently changed entity.
      await lockUser(tx, userId);
      const [runs, steps, latest] = await Promise.all([
        tx.runningHistory.findMany({
          where: { userId, revision: { gt: cursor } },
          orderBy: { revision: "asc" },
          take: 51
        }),
        tx.dailySteps.findMany({
          where: { userId, revision: { gt: cursor } },
          orderBy: { revision: "asc" },
          take: 51
        }),
        tx.activitySyncMutation.findFirst({
          where: { userId },
          orderBy: { revision: "desc" }
        })
      ]);
      const candidates = [
        ...runs.map((record) => ({ type: "run", record })),
        ...steps.map((record) => ({ type: "steps", record }))
      ].sort((left, right) => {
        const a = BigInt(left.record.revision);
        const b = BigInt(right.record.revision);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const page = candidates.slice(0, 50);
      const hasMore = candidates.length > page.length;
      const watermark = hasMore
        ? BigInt(page[page.length - 1].record.revision)
        : latest ? BigInt(latest.revision) : cursor;
      return {
        afterRevision: cursor.toString(),
        revision: (watermark > cursor ? watermark : cursor).toString(),
        hasMore,
        runs: page.filter((item) => item.type === "run").map((item) => toRunDto(item.record)),
        steps: page.filter((item) => item.type === "steps").map((item) => toStepsDto(item.record))
      };
    });
  }

  return { processBatch, processRun, processSteps, pullState };
}

function runData(userId, run, revision, timestamp) {
  return {
    userId,
    externalRunId: run.runId,
    distanceKm: run.distanceKm,
    durationSeconds: run.durationSeconds,
    averageSpeed: run.averageSpeed,
    paceMinutesPerKm: run.paceMinutesPerKm,
    route: run.route.map((point) => ({ ...point, timestamp: point.timestamp.toISOString() })),
    calories: run.calories ?? null,
    steps: run.steps ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    performedAt: run.finishedAt,
    deletedAt: run.deletedAt ?? null,
    revision,
    createdAt: timestamp
  };
}

function sameRun(record, run) {
  const route = Array.isArray(record.route) ? record.route : [];
  const sameContent = record.externalRunId === run.runId &&
    record.distanceKm === run.distanceKm &&
    record.durationSeconds === run.durationSeconds &&
    record.averageSpeed === run.averageSpeed &&
    record.paceMinutesPerKm === run.paceMinutesPerKm &&
    record.startedAt.toISOString() === run.startedAt.toISOString() &&
    record.finishedAt.toISOString() === run.finishedAt.toISOString() &&
    nullableNumber(record.calories) === nullableNumber(run.calories) &&
    nullableNumber(record.steps) === nullableNumber(run.steps) &&
    JSON.stringify(route.map(canonicalRoutePoint)) === JSON.stringify(run.route.map(canonicalRoutePoint));
  if (!sameContent) return false;
  if (record.deletedAt && !run.deletedAt) return false;
  if (record.deletedAt && run.deletedAt) {
    return nullableDate(record.deletedAt) === nullableDate(run.deletedAt);
  }
  return true;
}

function toRunDto(record) {
  return {
    runId: record.externalRunId,
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt.toISOString(),
    durationSeconds: record.durationSeconds,
    distanceKm: record.distanceKm,
    averageSpeed: record.averageSpeed,
    paceMinutesPerKm: record.paceMinutesPerKm,
    route: record.route,
    calories: record.calories,
    steps: record.steps,
    deletedAt: record.deletedAt?.toISOString() || null,
    revision: BigInt(record.revision).toString()
  };
}

function toStepsDto(record) {
  return {
    dayKey: record.dayKey,
    steps: record.steps,
    goal: record.goal,
    source: record.source,
    observedAt: record.observedAt.toISOString(),
    revision: BigInt(record.revision).toString()
  };
}

async function findMutation(client, userId, mutationId) {
  return client.activitySyncMutation.findUnique({
    where: { userId_mutationId: { userId, mutationId } }
  });
}

async function lockUser(tx, userId) {
  // Namespace 19 is reserved for canonical ActivitySync/v2 transactions.
  // IDs are parameters, never SQL text. Hash collisions only serialize users.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 19))`;
}

function duplicateAck(record) {
  return { bucket: "alreadyApplied", data: acknowledgement(record) };
}

function acknowledgement(record) {
  return {
    mutationId: record.mutationId,
    entityType: record.entityType,
    entityKey: record.entityKey,
    revision: BigInt(record.revision).toString(),
    processedAt: record.processedAt.toISOString()
  };
}

function entityAcknowledgement(mutationId, entityType, entityKey, revision) {
  return { mutationId, entityType, entityKey, revision: BigInt(revision).toString() };
}

function rejection(mutationId, entityType, code, details) {
  return { mutationId: String(mutationId || "unknown"), entityType, code, details };
}

function nullableNumber(value) { return value === undefined || value === null ? null : Number(value); }
// PostgreSQL jsonb does not preserve key order; immutable comparison must not
// depend on object insertion order. Missing legacy progress stays missing.
function canonicalRoutePoint(point) {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: point.accuracy,
    altitude: point.altitude,
    speed: point.speed,
    timestamp: new Date(point.timestamp).toISOString(),
    ...(point.cumulativeDistanceKm !== undefined ? { cumulativeDistanceKm: point.cumulativeDistanceKm } : {}),
    ...(point.activeElapsedSeconds !== undefined ? { activeElapsedSeconds: point.activeElapsedSeconds } : {}),
    ...(point.startsSegment !== undefined ? { startsSegment: point.startsSegment } : {})
  };
}
function nullableDate(value) { return value ? new Date(value).toISOString() : null; }
function isUniqueConstraintError(error) { return error?.code === "P2002"; }

const service = createActivitySyncService();
module.exports = { ...service, createActivitySyncService };
