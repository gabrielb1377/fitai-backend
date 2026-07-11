CREATE TABLE "ready_plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "coverImage" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "daysPerWeek" INTEGER NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ready_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ready_plan_days" (
    "id" TEXT NOT NULL,
    "readyPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weekday" TEXT,
    "muscleGroup" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ready_plan_days_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ready_plan_exercises" (
    "id" TEXT NOT NULL,
    "readyPlanDayId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "muscles" TEXT[] NOT NULL,
    "equipment" TEXT[] NOT NULL,
    "sets" INTEGER NOT NULL,
    "reps" TEXT NOT NULL,
    "restSeconds" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ready_plan_exercises_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ready_plans_slug_key" ON "ready_plans"("slug");
CREATE INDEX "ready_plans_category_idx" ON "ready_plans"("category");
CREATE INDEX "ready_plans_isActive_idx" ON "ready_plans"("isActive");
CREATE UNIQUE INDEX "ready_plan_days_readyPlanId_order_key" ON "ready_plan_days"("readyPlanId", "order");
CREATE INDEX "ready_plan_days_readyPlanId_idx" ON "ready_plan_days"("readyPlanId");
CREATE UNIQUE INDEX "ready_plan_exercises_readyPlanDayId_order_key" ON "ready_plan_exercises"("readyPlanDayId", "order");
CREATE INDEX "ready_plan_exercises_readyPlanDayId_idx" ON "ready_plan_exercises"("readyPlanDayId");

ALTER TABLE "ready_plan_days" ADD CONSTRAINT "ready_plan_days_readyPlanId_fkey" FOREIGN KEY ("readyPlanId") REFERENCES "ready_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ready_plan_exercises" ADD CONSTRAINT "ready_plan_exercises_readyPlanDayId_fkey" FOREIGN KEY ("readyPlanDayId") REFERENCES "ready_plan_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;
