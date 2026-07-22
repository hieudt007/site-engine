-- AlterTable
ALTER TABLE "ProductCache" ADD COLUMN "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProductCache_slug_key" ON "ProductCache"("slug");
