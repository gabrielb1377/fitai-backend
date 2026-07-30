-- CreateTable
CREATE TABLE "workout_sync_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "version" INTEGER NOT NULL,

    CONSTRAINT "workout_sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sync_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalSessionId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "currentExerciseIndex" INTEGER NOT NULL DEFAULT 0,
    "currentSetIndex" INTEGER NOT NULL DEFAULT 0,
    "restEndsAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_sync_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout_sync_sets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalSetId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "setIndex" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workout_sync_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workout_sync_events_userId_idempotencyKey_key" ON "workout_sync_events"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "workout_sync_events_userId_eventId_key" ON "workout_sync_events"("userId", "eventId");
CREATE INDEX "workout_sync_events_userId_aggregateId_idx" ON "workout_sync_events"("userId", "aggregateId");
CREATE INDEX "workout_sync_events_userId_processedAt_idx" ON "workout_sync_events"("userId", "processedAt");
CREATE UNIQUE INDEX "workout_sync_sessions_userId_externalSessionId_key" ON "workout_sync_sessions"("userId", "externalSessionId");
CREATE INDEX "workout_sync_sessions_userId_status_idx" ON "workout_sync_sessions"("userId", "status");
CREATE UNIQUE INDEX "workout_sync_sets_userId_externalSetId_key" ON "workout_sync_sets"("userId", "externalSetId");
CREATE UNIQUE INDEX "workout_sync_sets_sessionId_exerciseId_setIndex_key" ON "workout_sync_sets"("sessionId", "exerciseId", "setIndex");
CREATE INDEX "workout_sync_sets_userId_sessionId_idx" ON "workout_sync_sets"("userId", "sessionId");

-- AddForeignKey
ALTER TABLE "workout_sync_events" ADD CONSTRAINT "workout_sync_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_sync_sessions" ADD CONSTRAINT "workout_sync_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_sync_sets" ADD CONSTRAINT "workout_sync_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workout_sync_sets" ADD CONSTRAINT "workout_sync_sets_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "workout_sync_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
