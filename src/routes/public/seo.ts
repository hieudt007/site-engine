import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";

// system_design.md §10.3 — sitemap gồm trang chủ, /blog + từng bài đã publish, /products + từng
// sản phẩm đã publish. JSON-LD/fallback SEO chain (§10.2/§10.4) chưa làm, vẫn TBD.
export async function registerSeoRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sitemap.xml", async (request, reply) => {
    const baseUrl = `https://${request.hostname}`;

    const [posts, products] = await Promise.all([
      prisma.post.findMany({ where: { publishedAt: { not: null } }, select: { slug: true, updatedAt: true } }),
      prisma.productCache.findMany({ where: { publishStatus: "published" }, select: { id: true, syncedAt: true } }),
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

    const urls = [...staticUrls, ...postUrls, ...productUrls];
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
