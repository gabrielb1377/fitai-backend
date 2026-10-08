-- The remote XP balance is derived from this immutable ledger. No mutable
-- client-provided balance is stored, so retry and multi-device convergence are
-- enforced by the database identity below.
CREATE TABLE "progression_xp_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "xpAwarded" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" BIGSERIAL NOT NULL,

    CONSTRAINT "progression_xp_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "progression_xp_events_revision_key"
    ON "progression_xp_events"("revision");
CREATE UNIQUE INDEX "progression_xp_events_userId_sourceType_sourceId_key"
    ON "progression_xp_events"("userId", "sourceType", "sourceId");
CREATE UNIQUE INDEX "progression_xp_events_userId_eventId_key"
    ON "progression_xp_events"("userId", "eventId");
CREATE INDEX "progression_xp_events_userId_revision_idx"
    ON "progression_xp_events"("userId", "revision");

ALTER TABLE "progression_xp_events"
    ADD CONSTRAINT "progression_xp_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
