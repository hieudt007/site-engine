-- DropIndex (leadbaseCategoryId doi tu unique TOAN BANG sang unique THEO TUNG type)
DROP INDEX "Category_leadbaseCategoryId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Category_type_leadbaseCategoryId_key" ON "Category"("type", "leadbaseCategoryId");

-- AlterTable
ALTER TABLE "ProductCache" ADD COLUMN "brandId" TEXT;

-- AddForeignKey
ALTER TABLE "ProductCache" ADD CONSTRAINT "ProductCache_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
