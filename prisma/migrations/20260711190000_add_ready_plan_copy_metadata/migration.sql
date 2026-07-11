ALTER TABLE "workouts"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN "readyPlanId" TEXT;

ALTER TABLE "workout_day_exercises"
ADD COLUMN "repsText" TEXT,
ADD COLUMN "rir" TEXT,
ADD COLUMN "cadence" TEXT,
ADD COLUMN "notes" TEXT;

ALTER TABLE "ready_plan_exercises"
ADD COLUMN "rir" TEXT,
ADD COLUMN "cadence" TEXT,
ADD COLUMN "notes" TEXT;

CREATE INDEX "workouts_readyPlanId_idx" ON "workouts"("readyPlanId");
CREATE UNIQUE INDEX "workouts_userId_readyPlanId_key" ON "workouts"("userId", "readyPlanId");

ALTER TABLE "workouts"
ADD CONSTRAINT "workouts_readyPlanId_fkey"
FOREIGN KEY ("readyPlanId") REFERENCES "ready_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
