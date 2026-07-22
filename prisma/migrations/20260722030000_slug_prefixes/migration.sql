-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN "postSlugPrefix" TEXT NOT NULL DEFAULT 'blog';
ALTER TABLE "SiteConfig" ADD COLUMN "pageSlugPrefix" TEXT NOT NULL DEFAULT 'p';
ALTER TABLE "SiteConfig" ADD COLUMN "productSlugPrefix" TEXT NOT NULL DEFAULT 'product';
