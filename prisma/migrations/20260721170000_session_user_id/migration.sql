-- AlterTable
ALTER TABLE "Session" ADD COLUMN "userId" INTEGER;

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
