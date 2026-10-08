-- Additive cursors for immutable completed sessions and existing plan soft deletes.
CREATE SEQUENCE "workout_history_revision_seq";
ALTER TABLE "workout_sync_sessions" ADD COLUMN "historyRevision" BIGINT;
UPDATE "workout_sync_sessions" SET "historyRevision" = nextval('workout_history_revision_seq')
WHERE "status" = 'completed';
CREATE UNIQUE INDEX "workout_sync_sessions_historyRevision_key" ON "workout_sync_sessions"("historyRevision");
CREATE INDEX "workout_sync_sessions_userId_historyRevision_idx" ON "workout_sync_sessions"("userId", "historyRevision");
CREATE SEQUENCE "plan_deletion_revision_seq";
ALTER TABLE "workouts" ADD COLUMN "deletionRevision" BIGINT;
UPDATE "workouts" SET "deletionRevision" = nextval('plan_deletion_revision_seq') WHERE "deletedAt" IS NOT NULL;
CREATE UNIQUE INDEX "workouts_deletionRevision_key" ON "workouts"("deletionRevision");
CREATE INDEX "workouts_userId_deletionRevision_idx" ON "workouts"("userId", "deletionRevision");
