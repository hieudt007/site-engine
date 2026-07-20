-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "ProductCache" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "ProductReview" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "customFields" JSONB;

