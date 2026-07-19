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

export async function renderPublic(template: string, data: Record<string, unknown>): Promise<string> {
  const slug = await activeThemeSlug();
  const engine = new Liquid({ root: path.join(THEMES_ROOT, slug), extname: ".liquid" });

  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });

  return engine.renderFile(template, {
    ...data,
    site: siteConfig ?? { siteName: "Website", tagline: null, logoUrl: null },
    year: new Date().getFullYear(),
  });
}
