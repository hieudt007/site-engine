-- AlterTable: SiteConfig - them cot pluginSettings de plugin doc/ghi "ban ghi" rieng cua no
-- (namespaced theo pluginSlug) ma khong can mo quyen ghi toan bang SiteConfig.
ALTER TABLE "SiteConfig" ADD COLUMN "pluginSettings" JSONB DEFAULT '{}';
