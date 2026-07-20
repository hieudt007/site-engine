-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "layoutMode" TEXT NOT NULL DEFAULT 'standard';

-- AlterTable
ALTER TABLE "ProductCache" ADD COLUMN     "layoutMode" TEXT NOT NULL DEFAULT 'standard';

