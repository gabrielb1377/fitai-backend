-- CreateTable
CREATE TABLE "daily_steps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "steps" INTEGER NOT NULL,
    "goal" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_steps_userId_idx" ON "daily_steps"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_steps_userId_date_key" ON "daily_steps"("userId", "date");

-- AddForeignKey
ALTER TABLE "daily_steps" ADD CONSTRAINT "daily_steps_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
