import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";
import { renderNotFound } from "../../services/notFoundPage.js";

const PAGE_SIZE = 12;

// Chỉ đọc ProductCache.status='published' (system_design.md §4.2/§8) — 'draft'/'pending_review'/
// 'scheduled' (chưa tới giờ) không lộ ra public. scheduled tự chuyển 'published' qua cron
// (services/publishScheduler.ts) nên ở đây chỉ cần lọc đúng 1 giá trị 'published'.
export async function registerProductsPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string } }>("/products", async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    const where = { status: "published" };
    const [products, total] = await Promise.all([
      prisma.productCache.findMany({
        where,
        orderBy: { syncedAt: "desc" },
        skip,
        take: PAGE_SIZE,
        include: { categories: { select: { name: true, slug: true } } },
      }),
      prisma.productCache.count({ where }),
    ]);

    const html = await renderPublic("products-list", {
      pageTitle: "Sản phẩm",
      products,
      hasPrev: page > 1,
      hasNext: skip + products.length < total,
      prevPage: page - 1,
      nextPage: page + 1,
    });

    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/products/danh-muc/:slug",
    async (request, reply) => {
      const category = await prisma.category.findUnique({
        where: { type_slug: { type: "product", slug: request.params.slug } },
        include: { children: { select: { name: true, slug: true } } },
      });
      if (!category) {
        return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy danh mục"));
      }

      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const where = { status: "published", categories: { some: { id: category.id } } };

      const [products, total] = await Promise.all([
        prisma.productCache.findMany({ where, orderBy: { syncedAt: "desc" }, skip, take: PAGE_SIZE }),
        prisma.productCache.count({ where }),
      ]);

      const seo = readSeo(category.seo);
      const html = await renderPublic("product-category", {
        pageTitle: seo.metaTitle ?? category.name,
        metaDescription: seo.metaDescription ?? category.excerpt ?? undefined,
        noindex: seo.noindex,
        category,
        products,
        hasPrev: page > 1,
        hasNext: skip + products.length < total,
        prevPage: page - 1,
        nextPage: page + 1,
      });

      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { id: string } }>("/products/:id", async (request, reply) => {
    const product = await prisma.productCache.findUnique({
      where: { id: request.params.id },
      include: { variants: true, categories: { select: { name: true, slug: true } } },
    });
    if (!product || product.status !== "published") {
      return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy sản phẩm"));
    }

    // Escape "</" trước khi nhúng JSON vào <script> - tránh chuỗi thuộc tính variant (sku/attr)
    // vô tình chứa "</script>" phá vỡ thẻ script (an toàn hơn là tin dữ liệu do LeadBase gửi).
    const variantsJson = JSON.stringify(product.variants).replace(/<\//g, "<\\/");

    const reviews = await prisma.productReview.findMany({
      where: { productCacheId: product.id, status: "approved" },
      orderBy: { createdAt: "desc" },
    });
    const avgRating = reviews.length
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
      : null;

    const pageData = { pageTitle: product.name, metaDescription: readSeo(product.seo).metaDescription };

    let html: string;
    if (product.layoutMode === "landing") {
      html = await renderPublic("landing", { ...pageData, rawHtml: product.description ?? "" });
    } else if (product.layoutMode === "custom") {
      html = await renderPublic("custom-content", { ...pageData, rawHtml: product.description ?? "" });
    } else {
      html = await renderPublic("product-detail", { ...pageData, product, variantsJson, reviews, avgRating });
    }

    return reply.type("text/html").send(html);
  });
}
