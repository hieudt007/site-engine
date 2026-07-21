import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db.js";
import { saveUploadedFile } from "./services/mediaStorage.js";

// Chay cung `npx prisma db seed` (goi 1 lan luc site MOI duoc khoi tao, xem seedAgents.ts) - set
// san ten site + logo/favicon cho site nay (WebBase), khong ghi de neu SiteConfig da ton tai
// (idempotent, tranh mat cau hinh admin da tu sua sau nay).
const SITE_NAME = "WebBase";
const LOGO_SOURCE = path.join(process.cwd(), "assets", "seed", "logo.png");

async function main() {
  const existing = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  if (existing) {
    console.log("[seedSiteConfig] SiteConfig đã tồn tại, bỏ qua.");
    return;
  }

  const buffer = await fs.readFile(LOGO_SOURCE);
  const { url } = await saveUploadedFile(buffer, "image/png");

  await prisma.siteConfig.create({
    data: { id: "singleton", domain: "webbase.vn", siteName: SITE_NAME, logoUrl: url, faviconUrl: url },
  });
  console.log(`[seedSiteConfig] Đã tạo SiteConfig siteName="${SITE_NAME}" logo=${url}.`);
}

main()
  .catch((err) => {
    console.error("[seedSiteConfig] Lỗi:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
