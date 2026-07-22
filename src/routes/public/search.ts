import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { ensureProductSlugs } from "../../services/productSlug.js";

const RESULT_LIMIT = 12;

function normalizeQuery(q: string | undefined): string {
  return (q ?? "").trim().replace(/\s+/g, " ");
}

export async function registerPublicSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>("/search", async (request, reply) => {
    const q = normalizeQuery(request.query.q);
    const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    const isBlog = siteConfig?.siteType === "blog";

    let posts: unknown[] = [];
    let pages: unknown[] = [];
    let products: unknown[] = [];

    if (q) {
      const [postResults, pageResults, productResults] = await Promise.all([
        prisma.post.findMany({
          where: {
            type: "post",
            status: "published",
            OR: [{ title: { contains: q, mode: "insensitive" } }, { excerpt: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }],
          },
          orderBy: { publishedAt: "desc" },
          take: RESULT_LIMIT,
          select: {
            slug: true,
            title: true,
            excerpt: true,
            coverImage: true,
            publishedAt: true,
            categories: { select: { name: true, slug: true } },
          },
        }),
        prisma.post.findMany({
          where: {
            type: "page",
            status: "published",
            OR: [{ title: { contains: q, mode: "insensitive" } }, { excerpt: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }],
          },
          orderBy: { updatedAt: "desc" },
          take: RESULT_LIMIT,
          select: { slug: true, title: true, excerpt: true, updatedAt: true },
        }),
        isBlog
          ? Promise.resolve([])
          : prisma.productCache.findMany({
              where: {
                status: "published",
                OR: [{ name: { contains: q, mode: "insensitive" } }, { excerpt: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
              },
              orderBy: { syncedAt: "desc" },
              take: RESULT_LIMIT,
              select: { id: true, slug: true, name: true, imageUrls: true, price: true, salePrice: true } as any,
            }),
      ]);

      posts = postResults;
      pages = pageResults;
      products = isBlog ? [] : await ensureProductSlugs(productResults as any);
    }

    const html = await renderPublic("search", {
      pageTitle: q ? `Tìm kiếm: ${q}` : "Tìm kiếm",
      noindex: true,
      breadcrumbs: [
        { name: "Trang chủ", url: "/" },
        { name: "Tìm kiếm", url: "/search" },
      ],
      breadcrumbVariant: "default",
      q,
      hasQuery: q.length > 0,
      posts,
      pages,
      products,
      totalResults: posts.length + pages.length + products.length,
    });

    return reply.type("text/html").send(html);
  });
}
