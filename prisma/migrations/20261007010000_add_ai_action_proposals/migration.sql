CREATE TABLE "ai_action_proposals" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "sourceMessageId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL, "actionType" TEXT NOT NULL, "status" TEXT NOT NULL,
  "title" TEXT NOT NULL, "explanation" TEXT NOT NULL, "payload" JSONB NOT NULL, "preview" JSONB NOT NULL,
  "expectedBefore" JSONB, "expectedAfter" JSONB, "validationCode" TEXT NOT NULL,
  "executionDeviceId" TEXT, "resultReference" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_action_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_action_status_check" CHECK ("status" IN ('VALIDATED','REJECTED','CONFIRMED','EXECUTED','EXPIRED','CANCELLED'))
);
CREATE UNIQUE INDEX "ai_action_proposals_sourceMessageId_ordinal_key" ON "ai_action_proposals"("sourceMessageId", "ordinal");
CREATE INDEX "ai_action_proposals_userId_status_createdAt_idx" ON "ai_action_proposals"("userId", "status", "createdAt");
CREATE INDEX "ai_action_proposals_conversationId_idx" ON "ai_action_proposals"("conversationId");
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "ai_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
