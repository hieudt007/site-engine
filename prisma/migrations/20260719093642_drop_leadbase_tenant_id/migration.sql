/*
  Warnings:

  - You are about to drop the column `leadbaseTenantId` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `leadbaseTenantId` on the `SiteConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Session" DROP COLUMN "leadbaseTenantId";

-- AlterTable
ALTER TABLE "SiteConfig" DROP COLUMN "leadbaseTenantId";
