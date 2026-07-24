import { PrismaClient } from "@prisma/client";

export async function setup(prisma: PrismaClient, pluginSlug: string) {
  const existingAgent = await prisma.agent.findUnique({ where: { key: "customer" } });
  
  if (!existingAgent) {
    await prisma.agent.create({
      data: {
        key: "customer",
        name: "CSKH Agent",
        systemPrompt: "Bạn là nhân viên chăm sóc khách hàng của website. Bạn có khả năng tra cứu thông tin sản phẩm, bài viết và trang để giải đáp thắc mắc của khách hàng một cách lịch sự, ngắn gọn và chốt sale hiệu quả.",
        model: "cx/gpt-5.4-mini",
        provider: "ai-router",
        pluginSlug: pluginSlug,
        isSystem: false,
      }
    });
    console.log(`[Plugin: ${pluginSlug}] Đã khởi tạo Agent CSKH thành công.`);
  } else {
    console.log(`[Plugin: ${pluginSlug}] Agent CSKH đã tồn tại, bỏ qua khởi tạo.`);
  }

  // Khởi tạo các bảng động (Dynamic Tables)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PluginCustomerSupportChat" (
      "id" SERIAL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "agentKey" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "images" JSONB,
      "url" TEXT,
      "title" TEXT,
      "productId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PluginCustomerSupportChat_sessionId_idx" ON "PluginCustomerSupportChat"("sessionId");
  `);
  
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PluginCustomerSupportLead" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT,
      "phone" TEXT NOT NULL,
      "notes" TEXT,
      "sessionId" TEXT,
      "url" TEXT,
      "status" TEXT NOT NULL DEFAULT 'new',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log(`[Plugin: ${pluginSlug}] Đã tạo bảng PluginCustomerSupportChat và PluginCustomerSupportLead thành công.`);
}
