import type { PrismaClient } from "@prisma/client";

const DEFAULT_MODEL = "cx/gpt-5.4-mini";

const PLUGIN_AGENTS: { name: string; key: string; systemPrompt: string }[] = [
  {
    name: "Chat Agent",
    key: "chat",
    systemPrompt:
      "Bạn là một trợ lý AI hỗ trợ quản trị viên của hệ thống Site Engine. Bạn có thể sử dụng các công cụ để giải đáp thắc mắc, phân tích dữ liệu, hoặc điều hướng người dùng.",
  },
  {
    name: "Content Agent",
    key: "content",
    systemPrompt:
      "Bạn là trợ lý viết nội dung tiếng Việt cho blog/website bán hàng. Viết tự nhiên, đúng ngữ pháp, không lan man, không bịa số liệu/cam kết cụ thể không được cung cấp.",
  }
];

export async function setup(prisma: PrismaClient, slug: string) {
  // Tạo bảng dynamic PluginAdminAiChatHistory cho plugin
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PluginAdminAiChatHistory" (
      "id"                SERIAL PRIMARY KEY,
      "userId"            INTEGER NOT NULL,
      "userMessage"       TEXT NOT NULL,
      "imageUrl"          TEXT,
      "assistantResponse" TEXT,
      "status"            TEXT NOT NULL DEFAULT 'success',
      "errorMessage"      TEXT,
      "entityId"          TEXT,
      "metadata"          TEXT,
      "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PluginAdminAiChatHistory_userId_createdAt_idx"
      ON "PluginAdminAiChatHistory"("userId", "createdAt" DESC)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PluginAdminAiChatHistory_entityId_idx"
      ON "PluginAdminAiChatHistory"("entityId")
  `);

  // Đảm bảo 2 agent chat và content của plugin được tạo
  for (const def of PLUGIN_AGENTS) {
    const existing = await prisma.agent.findFirst({ where: { key: def.key } });
    if (!existing) {
      await prisma.agent.create({
        data: {
          name: def.name,
          provider: "ai-router",
          model: DEFAULT_MODEL,
          key: def.key,
          systemPrompt: def.systemPrompt,
          isActive: true,
        },
      });
      console.log(`[Plugin: ${slug}] Đã tạo agent "${def.name}" (key=${def.key}).`);
    }
  }

  console.log(`[Plugin: ${slug}] Plugin setup completed.`);
}
