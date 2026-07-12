-- Preserve existing per-set records while adding stable sync metadata.
ALTER TABLE "exercise_histories"
  ADD COLUMN "exerciseKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "exerciseName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "workoutSessionId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "setNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "completed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "restSeconds" INTEGER,
  ADD COLUMN "rir" TEXT,
  ADD COLUMN "notes" TEXT;

CREATE INDEX "exercise_histories_userId_exerciseKey_idx"
  ON "exercise_histories"("userId", "exerciseKey");

CREATE INDEX "exercise_histories_userId_workoutSessionId_idx"
  ON "exercise_histories"("userId", "workoutSessionId");
