-- Keep completed workout history referentially intact while allowing a plan
-- definition to disappear from the active synchronized collection.
ALTER TABLE "workouts" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "workouts_userId_deletedAt_idx" ON "workouts"("userId", "deletedAt");
