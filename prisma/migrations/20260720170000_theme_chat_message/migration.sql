-- CreateTable
CREATE TABLE "ThemeChatMessage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThemeChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThemeChatMessage_slug_createdAt_idx" ON "ThemeChatMessage"("slug", "createdAt");

