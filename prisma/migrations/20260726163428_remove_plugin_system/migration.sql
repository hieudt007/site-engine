-- He thong plugin dong (Plugin/PluginRecord, chay code khong sandbox tu src/addons/) da bi go bo
-- hoan toan vi rui ro bao mat - xem prisma/schema.prisma va routes/admin/plugins.ts. Tinh nang
-- "customer-support" duy nhat con dung that da chuyen thanh core (CustomerChatMessage/CustomerChatLead).
DROP TABLE IF EXISTS "PluginRecord";
DROP TABLE IF EXISTS "Plugin";

ALTER TABLE "SiteConfig" DROP COLUMN IF EXISTS "pluginSettings";
