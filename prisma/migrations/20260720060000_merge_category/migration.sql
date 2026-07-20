-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "ProductCache" DROP CONSTRAINT "ProductCache_categoryId_fkey";

-- DropTable
DROP TABLE "PostCategory";

-- DropTable
DROP TABLE "ProductCategoryCache";

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'post',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "leadbaseCategoryId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "excerpt" TEXT,
    "body" TEXT,
    "seo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_leadbaseCategoryId_key" ON "Category"("leadbaseCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_type_slug_key" ON "Category"("type", "slug");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCache" ADD CONSTRAINT "ProductCache_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

