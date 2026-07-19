import { prisma } from "../db.js";
import type { SiteConfig } from "@prisma/client";

// SiteConfig là singleton (system_design.md §10.1) nhưng trước đây chỉ được tạo lười ở
// routes/admin/settings.ts (lần đầu ai đó vào /admin/settings/general) — nếu chưa ai vào đó,
// orderRetry.ts không biết domain của chính instance để gửi đơn retry, cron lặng lẽ bỏ qua mãi
// mãi. Giờ dùng chung helper này, gọi cả ở lúc checkout (routes/public/cart.ts) để đảm bảo row
// tồn tại ngay từ đơn hàng ĐẦU TIÊN, không phụ thuộc admin đã ghé settings hay chưa.
export async function getOrCreateSiteConfig(domain: string): Promise<SiteConfig> {
  const existing = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  if (existing) {
    return existing;
  }
  return prisma.siteConfig.create({
    data: { id: "singleton", domain, siteName: domain },
  });
}
