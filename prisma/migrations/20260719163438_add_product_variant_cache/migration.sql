-- AlterTable
ALTER TABLE "ProductCache" ADD COLUMN     "hasVariants" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductVariantCache" (
    "id" TEXT NOT NULL,
    "productCacheId" TEXT NOT NULL,
    "leadbaseVariantId" TEXT NOT NULL,
    "sku" TEXT,
    "attributes" JSONB,
    "price" DECIMAL(65,30) NOT NULL,
    "salePrice" DECIMAL(65,30),
    "stock" INTEGER,
    "leadbaseStatus" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariantCache_leadbaseVariantId_key" ON "ProductVariantCache"("leadbaseVariantId");

-- AddForeignKey
ALTER TABLE "ProductVariantCache" ADD CONSTRAINT "ProductVariantCache_productCacheId_fkey" FOREIGN KEY ("productCacheId") REFERENCES "ProductCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;
