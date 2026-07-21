import path from "node:path";
import { Liquid } from "liquidjs";
import { prisma } from "../db.js";

// Render trang HTML trong /admin (list bài viết, editor) — KHÔNG dùng theme (khác themeRenderer.ts
// vốn dành cho trang public, có thể đổi theo ThemeConfig.activeTheme). views/admin/ là thư mục
// cố định, đóng gói cùng dist/ khi build zip (scripts/build-release.sh).
const VIEWS_ROOT = path.join(process.cwd(), "views", "admin");
const engine = new Liquid({ root: VIEWS_ROOT, extname: ".liquid" });

export async function renderAdmin(template: string, data: Record<string, unknown>): Promise<string> {
  // Lay favicon + logo/ten TU CHINH site (SiteConfig, giong /admin/settings/general) de
  // layout.liquid hien (favicon tab trinh duyet, logo+ten sidebar) - fetch o day (1 cho duy nhat)
  // thay vi tung route admin tu truyen, tranh phai sua hang chuc file.
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  return engine.renderFile(template, {
    faviconUrl: siteConfig?.faviconUrl ?? null,
    sidebarLogoUrl: siteConfig?.logoUrl ?? null,
    sidebarSiteName: siteConfig?.siteName ?? "Quản trị",
    siteType: siteConfig?.siteType ?? "ecommerce",
    ...data,
  });
}
