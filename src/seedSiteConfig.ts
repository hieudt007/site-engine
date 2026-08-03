import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db.js";
import { saveUploadedFile } from "./services/mediaStorage.js";

// Chay cung `npx prisma db seed` (goi 1 lan luc site MOI duoc khoi tao, xem seedAgents.ts) - set
// san ten site + logo/favicon cho site nay, khong ghi de neu SiteConfig da ton tai (idempotent,
// tranh mat cau hinh admin da tu sua sau nay).
//
// SITE_DOMAIN (do lead-base-node's siteEngineProvision.ts ghi vao .env luc "env" step) LA domain
// THAT cua tenant nay - PHAI dung de tao SiteConfig.domain ngay tu day, KHONG duoc de trong/fallback
// gia. Ly do: co 2 ham auto-create SiteConfig khac nhau trong code (CacheService.getSiteConfig(),
// dung cho MOI trang public, va getOrCreateSiteConfig() dung rieng cho settings/checkout) - neu
// seed nay khong tao truoc voi domain dung, request public DAU TIEN (vd health-check ngay sau khi
// "start") se thang cuoc dua va tu tao row voi domain sai (thay vao gia tri fallback cung "localhost"
// cua CacheService), khoa cung domain sai vinh vien vi khong co gi tu sua lai sau do - loi that da
// gap (trang /admin/pages/new hien sai "https://localhost/..." tren tenant that leadbase.vn).
const LOGO_SOURCE = path.join(process.cwd(), "assets", "seed", "logo.png");

async function main() {
  const existing = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  if (existing) {
    console.log("[seedSiteConfig] SiteConfig đã tồn tại, bỏ qua.");
    return;
  }

  const domain = process.env.SITE_DOMAIN || "webbase.vn";
  const siteName = process.env.SITE_DOMAIN || "WebBase";
  const buffer = await fs.readFile(LOGO_SOURCE);
  const { url } = await saveUploadedFile(buffer, "image/png");

  await prisma.siteConfig.create({
    data: { id: "singleton", domain, siteName, logoUrl: url, faviconUrl: url },
  });
  console.log(`[seedSiteConfig] Đã tạo SiteConfig domain="${domain}" siteName="${siteName}" logo=${url}.`);
}

main()
  .catch((err) => {
    console.error("[seedSiteConfig] Lỗi:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
