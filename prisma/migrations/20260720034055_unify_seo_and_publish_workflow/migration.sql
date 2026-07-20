/*
  Warnings:

  - You are about to drop the column `metaDescription` on the `Page` table. All the data in the column will be lost.
  - You are about to drop the column `metaTitle` on the `Page` table. All the data in the column will be lost.
  - You are about to drop the column `noindex` on the `Page` table. All the data in the column will be lost.
  - You are about to drop the column `ogImage` on the `Page` table. All the data in the column will be lost.
  - You are about to drop the column `metaDescription` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `metaTitle` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `noindex` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `ogImage` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `metaDescription` on the `ProductCache` table. All the data in the column will be lost.
  - You are about to drop the column `metaTitle` on the `ProductCache` table. All the data in the column will be lost.
  - You are about to drop the column `publishStatus` on the `ProductCache` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Page" DROP COLUMN "metaDescription",
DROP COLUMN "metaTitle",
DROP COLUMN "noindex",
DROP COLUMN "ogImage",
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "seo" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "metaDescription",
DROP COLUMN "metaTitle",
DROP COLUMN "noindex",
DROP COLUMN "ogImage",
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "seo" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';

-- AlterTable
ALTER TABLE "ProductCache" DROP COLUMN "metaDescription",
DROP COLUMN "metaTitle",
DROP COLUMN "publishStatus",
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "seo" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft';
