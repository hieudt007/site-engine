-- CustomerChatMessage/CustomerChatLead: truoc day la bang raw SQL cua plugin "customer-support"
-- (PluginCustomerSupportChat/PluginCustomerSupportLead, tao boi install.ts, khong qua Prisma).
-- Doi ten sang core, giu nguyen du lieu cu (khong tao lai tu dau).
ALTER TABLE "PluginCustomerSupportChat" RENAME TO "CustomerChatMessage";
ALTER TABLE "PluginCustomerSupportLead" RENAME TO "CustomerChatLead";

DROP INDEX IF EXISTS "PluginCustomerSupportChat_sessionId_idx";
CREATE INDEX IF NOT EXISTS "CustomerChatMessage_sessionId_id_idx" ON "CustomerChatMessage"("sessionId", "id");
