-- AlterTable
ALTER TABLE "ProductCache" ADD COLUMN "excerpt" TEXT;
ALTER TABLE "ProductCache" ADD COLUMN "soldCount" INTEGER NOT NULL DEFAULT 0;
