-- AlterTable
ALTER TABLE "CartOrder"
  ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'cod',
  ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN "vnpayTxnRef" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "CartOrder_vnpayTxnRef_key" ON "CartOrder"("vnpayTxnRef");

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_method_key" ON "PaymentMethod"("method");
