-- ActivitySyncContract/v2 adds stable run identity, daily step identity and a
-- monotonic mutation ledger without dropping legacy data.
ALTER TABLE "running_histories"
  ADD COLUMN "externalRunId" TEXT,
  ADD COLUMN "paceMinutesPerKm" DOUBLE PRECISION,
  ADD COLUMN "route" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "calories" DOUBLE PRECISION,
  ADD COLUMN "steps" INTEGER,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "finishedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "revision" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "running_histories"
SET
  "externalRunId" = "id",
  "finishedAt" = "performedAt",
  "startedAt" = "performedAt" - ("durationSeconds" * INTERVAL '1 second'),
  "paceMinutesPerKm" = CASE
    WHEN "distanceKm" > 0 THEN ("durationSeconds" / 60.0) / "distanceKm"
    ELSE 0
  END;

ALTER TABLE "running_histories"
  ALTER COLUMN "externalRunId" SET NOT NULL,
  ALTER COLUMN "paceMinutesPerKm" SET NOT NULL,
  ALTER COLUMN "startedAt" SET NOT NULL,
  ALTER COLUMN "finishedAt" SET NOT NULL;

CREATE UNIQUE INDEX "running_histories_userId_externalRunId_key"
  ON "running_histories"("userId", "externalRunId");
CREATE INDEX "running_histories_userId_revision_idx"
  ON "running_histories"("userId", "revision");

ALTER TABLE "daily_steps"
  ADD COLUMN "dayKey" TEXT,
  ADD COLUMN "deviceId" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "observedAt" TIMESTAMP(3),
  ADD COLUMN "revision" BIGINT NOT NULL DEFAULT 0;

UPDATE "daily_steps"
SET
  "dayKey" = TO_CHAR("date" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
  "observedAt" = "updatedAt";

ALTER TABLE "daily_steps"
  ALTER COLUMN "dayKey" SET NOT NULL,
  ALTER COLUMN "observedAt" SET NOT NULL;

CREATE UNIQUE INDEX "daily_steps_userId_dayKey_key"
  ON "daily_steps"("userId", "dayKey");
CREATE INDEX "daily_steps_userId_revision_idx"
  ON "daily_steps"("userId", "revision");

CREATE TABLE "activity_sync_mutations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityKey" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revision" BIGSERIAL NOT NULL,
  CONSTRAINT "activity_sync_mutations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_sync_mutations_revision_key"
  ON "activity_sync_mutations"("revision");
CREATE UNIQUE INDEX "activity_sync_mutations_userId_mutationId_key"
  ON "activity_sync_mutations"("userId", "mutationId");
CREATE INDEX "activity_sync_mutations_userId_revision_idx"
  ON "activity_sync_mutations"("userId", "revision");

ALTER TABLE "activity_sync_mutations"
  ADD CONSTRAINT "activity_sync_mutations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
