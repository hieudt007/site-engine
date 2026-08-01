-- CustomerChatMessage/CustomerChatLead: truoc day la bang raw SQL cua plugin "customer-support"
-- (PluginCustomerSupportChat/PluginCustomerSupportLead, tao boi install.ts, khong qua Prisma).
-- Doi ten sang core, giu nguyen du lieu cu (khong tao lai tu dau).

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'PluginCustomerSupportChat') THEN
        ALTER TABLE "PluginCustomerSupportChat" RENAME TO "CustomerChatMessage";
        ALTER TABLE "PluginCustomerSupportLead" RENAME TO "CustomerChatLead";
    END IF;
END $$;

DROP INDEX IF EXISTS "PluginCustomerSupportChat_sessionId_idx";

CREATE TABLE IF NOT EXISTS "CustomerChatMessage" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "images" JSONB,
    "url" TEXT,
    "title" TEXT,
    "productId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerChatLead" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "sessionId" TEXT,
    "url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerChatLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerChatMessage_sessionId_id_idx" ON "CustomerChatMessage"("sessionId", "id");
