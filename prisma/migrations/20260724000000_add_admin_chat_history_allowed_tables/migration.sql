-- CreateTable: AdminChatHistory (lịch sử trò chuyện admin với AI)
CREATE TABLE "AdminChatHistory" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "userMessage" TEXT NOT NULL,
    "imageUrl" TEXT,
    "assistantResponse" TEXT,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "entityId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminChatHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminChatHistory_userId_createdAt_idx" ON "AdminChatHistory"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AdminChatHistory_entityId_idx" ON "AdminChatHistory"("entityId");

-- AddForeignKey
ALTER TABLE "AdminChatHistory" ADD CONSTRAINT "AdminChatHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("leadbaseUserId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Plugin - add allowedTables column
ALTER TABLE "Plugin" ADD COLUMN IF NOT EXISTS "allowedTables" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
