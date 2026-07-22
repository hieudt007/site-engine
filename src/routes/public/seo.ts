import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { pagePath, postCategoryPath, postPath, productCategoryPath, productPath, topicPath } from "../../services/urlPaths.js";

// system_design.md §10.3 — sitemap gồm trang chủ, /blog + từng bài đã publish, /products + từng
// sản phẩm đã publish. JSON-LD/fallback SEO chain (§10.2/§10.4) chưa làm, vẫn TBD.
export async function registerSeoRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sitemap.xml", async (request, reply) => {
    const baseUrl = `https://${request.hostname}`;

    const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    const isBlog = siteConfig?.siteType === "blog";
    const urlConfig = siteConfig as { postSlugPrefix?: string | null; pageSlugPrefix?: string | null; productSlugPrefix?: string | null } | null;

    const [posts, products, pages, postCategories, topics, productCategories] = await Promise.all([
      prisma.post.findMany({ where: { type: "post", status: "published" }, select: { slug: true, updatedAt: true } }),
      // siteType='blog' - khong liet ke URL san pham vao sitemap, tranh Google index roi dan
      // ve trang da bi chan 404 (xem onRequest hook trong server.ts).
      isBlog
        ? Promise.resolve([])
        : prisma.productCache.findMany({ where: { status: "published" }, select: { id: true, slug: true, syncedAt: true } as any }),
      prisma.post.findMany({ where: { type: "page", status: "published" }, select: { slug: true, updatedAt: true } }),
      prisma.category.findMany({ where: { type: "post" }, select: { slug: true, updatedAt: true } }),
      prisma.topic.findMany({ select: { slug: true, createdAt: true } }),
      isBlog ? Promise.resolve([]) : prisma.category.findMany({ where: { type: "product" }, select: { slug: true, updatedAt: true } }),
    ]);

    const staticUrls = [
      { loc: baseUrl, lastmod: null },
      { loc: `${baseUrl}/blog`, lastmod: null },
      ...(isBlog ? [] : [{ loc: `${baseUrl}/products`, lastmod: null }]),
    ];
    const postUrls = posts.map((p) => ({
      loc: `${baseUrl}${postPath(urlConfig ?? {}, p.slug)}`,
      lastmod: p.updatedAt.toISOString(),
    }));
    const productRows = products as Array<{ id: string; slug?: string | null; syncedAt: Date }>;
    const productUrls = productRows.map((p) => ({
      loc: `${baseUrl}${productPath(urlConfig ?? {}, ((p as any).slug as string | null | undefined) ?? p.id)}`,
      lastmod: p.syncedAt.toISOString(),
    }));
    const pageUrls = pages.map((p) => ({
      loc: `${baseUrl}${pagePath(urlConfig ?? {}, p.slug)}`,
      lastmod: p.updatedAt.toISOString(),
    }));
    const postCategoryUrls = postCategories.map((c) => ({
      loc: `${baseUrl}${postCategoryPath(urlConfig ?? {}, c.slug)}`,
      lastmod: c.updatedAt.toISOString(),
    }));
    const topicUrls = topics.map((t) => ({
      loc: `${baseUrl}${topicPath(urlConfig ?? {}, t.slug)}`,
      lastmod: t.createdAt.toISOString(),
    }));
    const productCategoryUrls = productCategories.map((c) => ({
      loc: `${baseUrl}${productCategoryPath(urlConfig ?? {}, c.slug)}`,
      lastmod: c.updatedAt.toISOString(),
    }));

    const urls = [...staticUrls, ...postUrls, ...productUrls, ...pageUrls, ...postCategoryUrls, ...topicUrls, ...productCategoryUrls];
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls
        .map(
          (u) =>
            `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
        )
        .join("\n") +
      "\n</urlset>\n";

    return reply.type("application/xml").send(xml);
  });

  app.get("/robots.txt", async (request, reply) => {
    const baseUrl = `https://${request.hostname}`;
    const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\nSitemap: ${baseUrl}/sitemap.xml\n`;
    return reply.type("text/plain").send(body);
  });

  // RSS 20 bài mới nhất đã xuất bản (chuẩn RSS 2.0) — trước đây chỉ có sitemap.xml cho công cụ
  // tìm kiếm, chưa có feed cho trình đọc RSS/tổng hợp tin.
  app.get("/feed.xml", async (request, reply) => {
    const baseUrl = `https://${request.hostname}`;
    const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    const siteName = siteConfig?.siteName ?? "Website";
    const urlConfig = siteConfig as { postSlugPrefix?: string | null; productSlugPrefix?: string | null } | null;

    const posts = await prisma.post.findMany({
      where: { type: "post", status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 20,
      select: { slug: true, title: true, excerpt: true, publishedAt: true, updatedAt: true },
    });

    const items = posts
      .map((p) => {
        const link = `${baseUrl}${postPath(urlConfig ?? {}, p.slug)}`;
        return (
          "  <item>\n" +
          `    <title>${escapeXml(p.title)}</title>\n` +
          `    <link>${escapeXml(link)}</link>\n` +
          `    <guid>${escapeXml(link)}</guid>\n` +
          (p.excerpt ? `    <description>${escapeXml(p.excerpt)}</description>\n` : "") +
          `    <pubDate>${(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>\n` +
          "  </item>"
        );
      })
      .join("\n");

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<rss version="2.0">\n' +
      "<channel>\n" +
      `  <title>${escapeXml(siteName)}</title>\n` +
      `  <link>${escapeXml(baseUrl)}/blog</link>\n` +
      `  <description>Bài viết mới nhất từ ${escapeXml(siteName)}</description>\n` +
      items +
      "\n</channel>\n</rss>\n";

    return reply.type("application/rss+xml").send(xml);
  });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}
