-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "cdnUrl" TEXT;

-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN     "r2AccessKeyId" TEXT,
ADD COLUMN     "r2AccountId" TEXT,
ADD COLUMN     "r2BucketName" TEXT,
ADD COLUMN     "r2PublicUrl" TEXT,
ADD COLUMN     "r2SecretAccessKey" TEXT;
