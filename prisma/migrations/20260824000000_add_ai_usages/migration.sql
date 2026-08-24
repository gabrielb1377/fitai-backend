CREATE TABLE "ai_usages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "response" JSONB,
    "errorCode" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usages_userId_operation_idempotencyKey_key"
ON "ai_usages"("userId", "operation", "idempotencyKey");

CREATE INDEX "ai_usages_userId_operation_periodStart_status_idx"
ON "ai_usages"("userId", "operation", "periodStart", "status");

ALTER TABLE "ai_usages"
ADD CONSTRAINT "ai_usages_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
