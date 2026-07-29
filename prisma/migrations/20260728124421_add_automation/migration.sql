-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "recurrence" TEXT NOT NULL DEFAULT 'once',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Automation_status_scheduledAt_idx" ON "Automation"("status", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("leadbaseUserId") ON DELETE SET NULL ON UPDATE CASCADE;
