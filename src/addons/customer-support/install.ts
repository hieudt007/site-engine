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
}
