const { z } = require("zod");
const prisma = require("../../config/prisma");
const AppError = require("../../shared/errors/app-error");
const { lockUser } = require("../activity_sync/activity_sync.service");
const querySchema = z.object({
  afterRevision: z.string().regex(/^\d{1,18}$/).default("0"),
  afterSetId: z.string().max(240).default("")
}).strict();

function parseQuery(query) {
  const result = querySchema.safeParse(query || {});
  if (!result.success) throw new AppError("Cursor de sync invalido.", 400, "invalid_sync_cursor");
  return result.data;
}

function createSyncReadService({ db = prisma } = {}) {
  async function pullHistory(userId, query = {}) {
    const { afterRevision, afterSetId } = parseQuery(query);
    const cursor = BigInt(afterRevision);
    return db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const session = await tx.workoutSyncSession.findFirst({
        where: { userId, status: "completed", historyRevision: afterSetId ? { gte: cursor } : { gt: cursor } },
        orderBy: { historyRevision: "asc" }
      });
      if (!session) return { revision: afterRevision, afterSetId: "", hasMore: false, session: null, sets: [] };
      const continuing = BigInt(session.historyRevision) === cursor && afterSetId;
      const rows = await tx.workoutSyncSet.findMany({
        where: { userId, sessionId: session.id, ...(continuing ? { externalSetId: { gt: afterSetId } } : {}) },
        orderBy: { externalSetId: "asc" }, take: 51
      });
      const page = rows.slice(0, 50);
      const moreSets = rows.length > 50;
      const next = moreSets ? null : await tx.workoutSyncSession.findFirst({
        where: { userId, status: "completed", historyRevision: { gt: session.historyRevision } },
        select: { id: true }
      });
      const start = await tx.workoutSyncEvent.findFirst({
        where: { userId, aggregateId: session.externalSessionId, eventType: "workout_session_started", status: { in: ["processed", "already_processed"] } },
        select: { payload: true }, orderBy: { processedAt: "asc" }
      });
      const metadata = start?.payload?.session || {};
      const sets = [];
      for (const row of page) {
        const event = await tx.workoutSyncEvent.findFirst({
          where: { userId, aggregateId: row.externalSetId, eventType: "workout_set_completed", status: { in: ["processed", "already_processed"] }, payload: { path: ["set", "id"], equals: row.externalSetId } },
          select: { payload: true }, orderBy: { processedAt: "asc" }
        });
        const extra = event?.payload?.set || {};
        sets.push({ id: row.externalSetId, sessionId: session.externalSessionId, exerciseId: row.exerciseId,
          setIndex: row.setIndex, weight: row.weight, reps: row.reps,
          completedAt: row.completedAt, updatedAt: row.updatedAt, version: row.version,
          canonicalExerciseId: extra.canonicalExerciseId || null, exerciseName: extra.exerciseName || null,
          restSeconds: extra.restSeconds ?? null, rpe: extra.rpe ?? null, notes: extra.notes || null, syncStatus: "synced" });
      }
      return { revision: String(session.historyRevision), afterSetId: moreSets ? page.at(-1).externalSetId : "",
        hasMore: moreSets || Boolean(next), session: {
          id: session.externalSessionId, planId: session.planId, workoutId: session.workoutId,
          startedAt: session.startedAt, finishedAt: session.finishedAt, updatedAt: session.updatedAt,
          status: session.status, currentExerciseIndex: session.currentExerciseIndex, currentSetIndex: session.currentSetIndex,
          restEndsAt: null, version: session.version, syncStatus: "synced",
          planName: metadata.planName || null, workoutName: metadata.workoutName || null,
          remoteImported: true, remoteHistoryComplete: !moreSets
        }, sets };
    });
  }

  async function pullPlanDeletions(userId, query = {}) {
    const { afterRevision } = parseQuery(query);
    return db.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const records = await tx.workout.findMany({
        where: { userId, deletedAt: { not: null }, deletionRevision: { gt: BigInt(afterRevision) } },
        select: { id: true, deletedAt: true, deletionRevision: true },
        orderBy: { deletionRevision: "asc" }, take: 51
      });
      const page = records.slice(0, 50);
      return { revision: page.length ? String(page.at(-1).deletionRevision) : afterRevision,
        hasMore: records.length > 50, deletions: page.map(row => ({ id: row.id, deletedAt: row.deletedAt })) };
    });
  }
  return { pullHistory, pullPlanDeletions };
}
module.exports = { createSyncReadService, ...createSyncReadService() };
