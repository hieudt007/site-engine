import path from "node:path";
import { Liquid } from "liquidjs";
import { prisma } from "../db.js";

// Render trang PUBLIC bằng theme đang active (system_design.md §10, tech_doc.md §3). Theme
// built-in nằm ở themes/{slug}/ (sibling của dist/, KHÔNG bị tsc build vào dist — copy nguyên
// văn khi đóng gói zip, xem scripts/build-release.sh). Sau này CustomTheme (Phase 6) sẽ giải nén
// vào cùng chỗ này với slug riêng, cùng cơ chế root động theo activeTheme.
const THEMES_ROOT = path.join(process.cwd(), "themes");

async function activeThemeSlug(): Promise<string> {
  const config = await prisma.themeConfig.findUnique({ where: { id: "singleton" } });
  return config?.activeTheme ?? "default";
}

// themeSlugOverride: dung cho preview 1 theme CHUA active (trang editor theme, xem
// routes/admin/themePreview.ts) - khong doi ThemeConfig, chi doi ROOT cua Liquid engine cho 1
// lan render nay thoi.
export async function renderPublic(template: string, data: Record<string, unknown>, themeSlugOverride?: string): Promise<string> {
  const slug = themeSlugOverride ?? (await activeThemeSlug());
  const engine = new Liquid({ root: path.join(THEMES_ROOT, slug), extname: ".liquid" });

  const [siteConfig, headerMenu, footerMenu] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { id: "singleton" } }),
    prisma.menu.findUnique({ where: { slug: "header" }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
    prisma.menu.findUnique({ where: { slug: "footer" }, include: { items: { orderBy: { sortOrder: "asc" } } } }),
  ]);

  return engine.renderFile(template, {
    ...data,
    site: siteConfig ?? { siteName: "Website", tagline: null, logoUrl: null, faviconUrl: null },
    // headerMenu/footerMenu co the null (chua tung luu, xem routes/admin/menus.ts) - theme tu
    // fallback ve nav cung khi rong (xem themes/default/layout.liquid).
    headerMenu,
    footerMenu,
    // De layout.liquid tu build URL /theme-assets/{slug}/assets/custom.css|js cua CHINH theme
    // dang active - xem routes/public/themeAssets.ts.
    themeSlug: slug,
    year: new Date().getFullYear(),
  });
}
