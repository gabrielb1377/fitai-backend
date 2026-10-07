CREATE TABLE "ai_conversations" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "initialUsageId" TEXT NOT NULL,
  "nextSequence" INTEGER NOT NULL DEFAULT 0,
  "lockVersion" INTEGER NOT NULL DEFAULT 0,
  "pendingUsageId" TEXT,
  "pendingUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_conversations_initialUsageId_key" ON "ai_conversations"("initialUsageId");
CREATE INDEX "ai_conversations_userId_updatedAt_idx" ON "ai_conversations"("userId", "updatedAt");
CREATE TABLE "ai_chat_messages" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "usageId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_chat_messages_role_check" CHECK ("role" IN ('user', 'assistant'))
);
CREATE UNIQUE INDEX "ai_chat_messages_usageId_role_key" ON "ai_chat_messages"("usageId", "role");
CREATE UNIQUE INDEX "ai_chat_messages_conversationId_sequence_key" ON "ai_chat_messages"("conversationId", "sequence");
CREATE INDEX "ai_chat_messages_conversationId_createdAt_idx" ON "ai_chat_messages"("conversationId", "createdAt");
