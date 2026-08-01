import path from "node:path";
import { Liquid } from "liquidjs";
import { prisma } from "../db.js";
import { CacheService } from "./CacheService.js";
import crypto from "node:crypto";
import { logger } from "../logger.js";
import { config as appConfig } from "../config.js";
import { buildOrganizationSchema } from "./schema.js";
import { pagePrefix, prefixPath, postPrefix, productPrefix } from "./urlPaths.js";

// Render trang PUBLIC bằng theme đang active (system_design.md §10, tech_doc.md §3). Theme
// built-in nằm ở themes/{slug}/ (sibling của dist/, KHÔNG bị tsc build vào dist — copy nguyên
// văn khi đóng gói zip, xem scripts/build-release.sh). Sau này CustomTheme (Phase 6) sẽ giải nén
// vào cùng chỗ này với slug riêng, cùng cơ chế root động theo activeTheme.
const THEMES_ROOT = path.join(process.cwd(), "themes");

async function activeThemeSlug(): Promise<string> {
  const config = await CacheService.getThemeConfig();
  return config?.activeTheme ?? "default";
}

// schemas: cac object JSON-LD RIENG cho trang nay (Product/BlogPosting/BreadcrumbList - xem
// services/schema.ts), route tu xay va truyen vao qua data.schemas - KHONG di qua Liquid template
// (xem ly do trong schema.ts). Chen thang vao HTML sau khi Liquid render xong, luon kem
// Organization/WebSite (moi trang, khong can route nao tu nho khai bao).
interface RenderData extends Record<string, unknown> {
  schemas?: Record<string, unknown>[];
}

export function injectSchemas(html: string, schemas: Record<string, unknown>[]): string {
  const scriptTags = schemas
    .map((s) => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, "\\u003c")}</script>`)
    .join("\n");
  return html.includes("</head>") ? html.replace("</head>", scriptTags + "\n</head>") : html + scriptTags;
}

// gaId/fbPixelId/customHeadScript la field CHI ADMIN tu nhap (Settings chung, requireRole
// "admin") - chen NGUYEN VAN vao moi trang public, GIONG CACH schema.org dang lam (theme-agnostic,
// khong theme/AI nao can biet field nay ton tai). Khong escape customHeadScript vi ban chat no
// LA HTML/JS admin chu dinh chen (vd TikTok Pixel/Hotjar) - tin tuong o cung muc voi viec admin
// da co toan quyen chinh sua theme/DB.
export function buildAnalyticsScripts(site: { gaId?: string | null; fbPixelId?: string | null; customHeadScript?: string | null; gscVerificationId?: string | null }): string {
  const parts: string[] = [];

  if (site.gscVerificationId) {
    parts.push(`<meta name="google-site-verification" content="${site.gscVerificationId}" />`);
  }

  if (site.gaId) {
    parts.push(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${site.gaId}"></script>` +
        `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
        `gtag('js',new Date());gtag('config','${site.gaId}');</script>`,
    );
  }

  if (site.fbPixelId) {
    parts.push(
      "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
        "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
        "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
        "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document," +
        `'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${site.fbPixelId}');` +
        "fbq('track','PageView');</script>" +
        `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${site.fbPixelId}&ev=PageView&noscript=1"/></noscript>`,
    );
  }

  if (site.customHeadScript) {
    parts.push(site.customHeadScript);
  }

  return parts.join("\n");
}

// themeSlugOverride: dung cho preview 1 theme CHUA active (trang editor theme, xem
// routes/admin/themePreview.ts) - khong doi ThemeConfig, chi doi ROOT cua Liquid engine cho 1
// lan render nay thoi.
export async function renderPublic(template: string, data: RenderData, themeSlugOverride?: string): Promise<string> {
  const slug = themeSlugOverride ?? (await activeThemeSlug());
  const engine = new Liquid({
    root: [
      path.join(THEMES_ROOT, slug),
      path.join(THEMES_ROOT, "default"),
    ],
    extname: ".liquid",
    cache: process.env.NODE_ENV === "production"
  });

  const [siteConfig, allMenus] = await Promise.all([
    CacheService.getSiteConfig(),
    CacheService.getMenus(),
  ]);
  const headerMenu = allMenus.find((m: any) => m.slug === "header") || null;
  const footerMenu = allMenus.find((m: any) => m.slug === "footer") || null;

  const { schemas, ...restData } = data;
  const site = siteConfig ?? {
    siteName: "Website",
    tagline: null,
    logoUrl: null,
    faviconUrl: null,
    domain: "localhost",
    gaId: null,
    fbPixelId: null,
    customHeadScript: null,
    gscVerificationId: null,
    postSlugPrefix: "blog",
    pageSlugPrefix: "p",
    productSlugPrefix: "product",
  };

  const urlConfig = site as { postSlugPrefix?: string | null; pageSlugPrefix?: string | null; productSlugPrefix?: string | null };
  const postUrlPrefix = prefixPath(postPrefix(urlConfig));
  const pageUrlPrefix = prefixPath(pagePrefix(urlConfig));
  const productUrlPrefix = prefixPath(productPrefix(urlConfig));

  // Tao token xac thuc cho Chat / Forms
  const chatSessionId = "sess_" + crypto.randomBytes(8).toString("hex");
  const chatHmacToken = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(chatSessionId).digest("hex");

  const contextData = {
    ...restData,
    site,
    // headerMenu/footerMenu co the null (chua tung luu, xem routes/admin/menus.ts) - theme tu
    // fallback ve nav cung khi rong (xem themes/default/layout.liquid).
    headerMenu,
    footerMenu,
    // pluginData/pluginAreas: he thong plugin dong da bi go bo (xem routes/admin/plugins.ts) -
    // giu 2 key nay rong de cac theme (minimal/misamom) con render "components/plugin/area"
    // khong bi loi (Liquid lap qua object/array rong = khong render gi, an toan).
    pluginData: {},
    pluginAreas: {},
    postUrlPrefix,
    pageUrlPrefix,
    productUrlPrefix,
    postCategoryPathPrefix: `${postUrlPrefix}/danh-muc`,
    topicPathPrefix: `${postUrlPrefix}/chu-de`,
    productCategoryPathPrefix: `${productUrlPrefix}/danh-muc`,
    brandPathPrefix: `${productUrlPrefix}/thuong-hieu`,
    // De layout.liquid tu build URL /theme-assets/{slug}/assets/custom.css|js cua CHINH theme
    // dang active - xem routes/public/themeAssets.ts.
    themeSlug: slug,
    year: new Date().getFullYear(),
    chatSessionId,
    chatHmacToken,
    // Cache buster - doi theo ngay deploy de browser buc tai file CSS/JS moi
    assetVersion: process.env.ASSET_VERSION || Date.now().toString(36).slice(-6),
  };

  // NẾU nội dung có chứa rawHtml (từ các trang Custom/Landing) -> Parse Liquid cho chính rawHtml trước khi đẩy ra layout
  if (typeof (contextData as any).rawHtml === "string" && (contextData as any).rawHtml.includes("{")) {
    try {
      (contextData as any).rawHtml = await engine.parseAndRender((contextData as any).rawHtml, contextData);
    } catch (e) {
      // Bỏ qua lỗi parse Liquid nếu cú pháp bị sai (để tránh sập trang), giữ nguyên html tĩnh
      logger.error(e, "Error parsing Liquid in rawHtml");
    }
  }

  const html = await engine.renderFile(template, contextData);

  const allSchemas = [buildOrganizationSchema({ siteName: site.siteName, logoUrl: site.logoUrl, domain: site.domain }), ...(schemas ?? [])];
  const withSchemas = injectSchemas(html, allSchemas);

  const analyticsScripts = buildAnalyticsScripts(site);
  let finalHtml = withSchemas;

  if (analyticsScripts) {
    finalHtml = finalHtml.includes("</head>")
      ? finalHtml.replace("</head>", analyticsScripts + "\n</head>")
      : finalHtml + analyticsScripts;
  }

  if (site.customFooterScript) {
    finalHtml = finalHtml.includes("</body>")
      ? finalHtml.replace("</body>", site.customFooterScript + "\n</body>")
      : finalHtml + site.customFooterScript;
  }

  return finalHtml;
}
