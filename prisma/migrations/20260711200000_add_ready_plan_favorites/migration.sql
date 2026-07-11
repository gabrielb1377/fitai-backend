ALTER TABLE "ready_plans"
ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "popularityCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ready_plan_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readyPlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ready_plan_favorites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ready_plan_favorites_userId_readyPlanId_key" ON "ready_plan_favorites"("userId", "readyPlanId");
CREATE INDEX "ready_plan_favorites_userId_idx" ON "ready_plan_favorites"("userId");
CREATE INDEX "ready_plan_favorites_readyPlanId_idx" ON "ready_plan_favorites"("readyPlanId");

ALTER TABLE "ready_plan_favorites"
ADD CONSTRAINT "ready_plan_favorites_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ready_plan_favorites"
ADD CONSTRAINT "ready_plan_favorites_readyPlanId_fkey"
FOREIGN KEY ("readyPlanId") REFERENCES "ready_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
