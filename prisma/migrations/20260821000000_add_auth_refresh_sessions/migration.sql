CREATE TABLE "auth_refresh_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_refresh_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_refresh_sessions_userId_revokedAt_idx"
ON "auth_refresh_sessions"("userId", "revokedAt");

CREATE INDEX "auth_refresh_sessions_expiresAt_idx"
ON "auth_refresh_sessions"("expiresAt");

ALTER TABLE "auth_refresh_sessions"
ADD CONSTRAINT "auth_refresh_sessions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
