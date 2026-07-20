import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";

// system_design.md §10.3 — sitemap gồm trang chủ, /blog + từng bài đã publish, /products + từng
// sản phẩm đã publish. JSON-LD/fallback SEO chain (§10.2/§10.4) chưa làm, vẫn TBD.
export async function registerSeoRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sitemap.xml", async (request, reply) => {
    const baseUrl = `https://${request.hostname}`;

    const [posts, products, pages, postCategories, productCategories] = await Promise.all([
      prisma.post.findMany({ where: { type: "post", status: "published" }, select: { slug: true, updatedAt: true } }),
      prisma.productCache.findMany({ where: { status: "published" }, select: { id: true, syncedAt: true } }),
      prisma.post.findMany({ where: { type: "page", status: "published" }, select: { slug: true, updatedAt: true } }),
      prisma.category.findMany({ where: { type: "post" }, select: { slug: true, updatedAt: true } }),
      prisma.category.findMany({ where: { type: "product" }, select: { slug: true, updatedAt: true } }),
    ]);

    const staticUrls = [
      { loc: baseUrl, lastmod: null },
      { loc: `${baseUrl}/blog`, lastmod: null },
      { loc: `${baseUrl}/products`, lastmod: null },
    ];
    const postUrls = posts.map((p) => ({
      loc: `${baseUrl}/blog/${p.slug}`,
      lastmod: p.updatedAt.toISOString(),
    }));
    const productUrls = products.map((p) => ({
      loc: `${baseUrl}/products/${p.id}`,
      lastmod: p.syncedAt.toISOString(),
    }));
    const pageUrls = pages.map((p) => ({
      loc: `${baseUrl}/trang/${p.slug}`,
      lastmod: p.updatedAt.toISOString(),
    }));
    const postCategoryUrls = postCategories.map((c) => ({
      loc: `${baseUrl}/blog/danh-muc/${c.slug}`,
      lastmod: c.updatedAt.toISOString(),
    }));
    const productCategoryUrls = productCategories.map((c) => ({
      loc: `${baseUrl}/products/danh-muc/${c.slug}`,
      lastmod: c.updatedAt.toISOString(),
    }));

    const urls = [...staticUrls, ...postUrls, ...productUrls, ...pageUrls, ...postCategoryUrls, ...productCategoryUrls];
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
