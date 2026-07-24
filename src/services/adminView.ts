import path from "node:path";
import { Liquid } from "liquidjs";
import { prisma } from "../db.js";

// Render trang HTML trong /admin (list bài viết, editor) — KHÔNG dùng theme (khác themeRenderer.ts
// vốn dành cho trang public, có thể đổi theo ThemeConfig.activeTheme). views/admin/ là thư mục
// cố định, đóng gói cùng dist/ khi build zip (scripts/build-release.sh).
const VIEWS_ROOT = path.join(process.cwd(), "views", "admin");
const ADDONS_ROOT = path.join(process.cwd(), "src", "addons");
const engine = new Liquid({ root: [VIEWS_ROOT, ADDONS_ROOT], extname: ".liquid" });

export async function renderAdmin(template: string, data: Record<string, unknown>): Promise<string> {
  // Lay favicon + logo/ten TU CHINH site (SiteConfig, giong /admin/settings/general) de
  // layout.liquid hien (favicon tab trinh duyet, logo+ten sidebar) - fetch o day (1 cho duy nhat)
  // thay vi tung route admin tu truyen, tranh phai sua hang chuc file.
  const [siteConfig, enabledPlugins] = await Promise.all([
    prisma.siteConfig.findUnique({ where: { id: "singleton" } }),
    prisma.plugin.findMany({ where: { enabled: true }, orderBy: { name: "asc" } }),
  ]);
  const pluginAdminPages = enabledPlugins.flatMap((plugin) => {
    const manifest = plugin.manifest as { adminPages?: Array<{ title?: string; path?: string; menuGroup?: string }> };
    return (manifest.adminPages ?? [])
      .filter((page) => page.title && page.path)
      .map((page) => ({
        title: page.title,
        href: `/admin/plugins/${plugin.slug}/${page.path}`,
        pluginName: plugin.name,
        menuGroup: page.menuGroup ?? "Plugins",
      }));
  });
  const adminFooterComponents = enabledPlugins.flatMap((plugin) => {
    const manifest = plugin.manifest as { adminFooterComponents?: Array<{ view?: string; excludePathPrefixes?: string[] }> };
    return (manifest.adminFooterComponents ?? [])
      .filter((comp) => comp.view)
      .map((comp) => ({
        viewPath: `${plugin.slug}/views/admin/components/${comp.view}`,
        excludePathPrefixes: comp.excludePathPrefixes ?? [],
      }));
  });
  return engine.renderFile(template, {
    faviconUrl: siteConfig?.faviconUrl ?? null,
    sidebarLogoUrl: siteConfig?.logoUrl ?? null,
    sidebarSiteName: siteConfig?.siteName ?? "Quản trị",
    siteType: siteConfig?.siteType ?? "ecommerce",
    siteDomain: siteConfig?.domain ?? "domain.com",
    postSlugPrefix: siteConfig?.postSlugPrefix ?? "blog",
    pageSlugPrefix: siteConfig?.pageSlugPrefix ?? "page",
    productSlugPrefix: siteConfig?.productSlugPrefix ?? "product",
    pluginAdminPages,
    adminFooterComponents,
    ...data,
  });
}

