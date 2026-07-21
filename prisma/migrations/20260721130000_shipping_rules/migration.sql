-- AlterTable
ALTER TABLE "CartOrder"
  ADD COLUMN "customerProvince" TEXT,
  ADD COLUMN "shippingFee" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ShippingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provinces" TEXT[],
    "baseFee" INTEGER NOT NULL,
    "freeShipThreshold" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRule_pkey" PRIMARY KEY ("id")
);
