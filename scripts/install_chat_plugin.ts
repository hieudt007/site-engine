import { prisma } from '../src/db.js';

async function install() {
  const manifest = {
    name: "Customer Support Chat",
    slug: "customer-support",
    version: "1.0.0",
    description: "Tích hợp AI CSKH tư vấn tự động ngoài website",
    permissions: {
      readModels: ["Post", "Page", "ProductCache"],
      ai: {
        enabled: true,
        agents: [
          {
            key: "customer",
            name: "CSKH Agent",
            systemPrompt: "Bạn là nhân viên chăm sóc khách hàng của website. Bạn có khả năng tra cứu thông tin sản phẩm, bài viết và trang để giải đáp thắc mắc của khách hàng một cách lịch sự, ngắn gọn và chốt sale hiệu quả."
          }
        ]
      }
    },
    collections: [
      { name: "customer_chat", label: "Lịch sử Chat Khách hàng" }
    ],
    publicBlocks: [
      {
        key: "chat-drawer",
        placement: "layout_before_footer",
        variant: "chat"
      }
    ],
    publicData: [],
    publicActions: [],
    adminPages: []
  };

  const existing = await prisma.plugin.findUnique({ where: { slug: manifest.slug } });
  if (!existing) {
    await prisma.plugin.create({
      data: {
        slug: manifest.slug,
        name: manifest.name,
        version: manifest.version,
        enabled: true,
        manifest: manifest as any
      }
    });

    await prisma.agent.create({
      data: {
        key: "customer",
        name: "CSKH Agent",
        systemPrompt: manifest.permissions.ai.agents[0].systemPrompt,
        model: "cx/gpt-5.4-mini",
        provider: "ai-router",
        pluginSlug: manifest.slug,
        isSystem: false,
      }
    });

    console.log("Đã cài đặt và kích hoạt Plugin Customer Support thành công!");
  } else {
    console.log("Plugin Customer Support đã tồn tại.");
  }
}

install().catch(console.error).finally(() => prisma.$disconnect());
