import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { buildProductSchema, buildBreadcrumbSchema } from "../../services/schema.js";

// URL tuyet doi cho JSON-LD (Product.url, BreadcrumbList.item...) - Schema.org yeu cau URL day du,
// khong chap nhan duong dan tuong doi.
async function siteBaseUrl(): Promise<string> {
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  const domain = siteConfig?.domain ?? "localhost";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

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
      const base = await siteBaseUrl();
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", base).toString() },
        { name: "Sản phẩm", url: new URL("/products", base).toString() },
        { name: category.name, url: new URL(`/products/danh-muc/${category.slug}`, base).toString() },
      ];
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
        schemas: [buildBreadcrumbSchema(breadcrumbItems)],
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
    // avgRating/reviewCount doc thang tu ProductCache (denormalize san - xem
    // services/productRatingAggregate.ts) thay vi tu tinh lai moi request - reviews[] van can fetch
    // rieng vi trang nay con hien TUNG binh luan, khong chi con so trung binh.
    const avgRating = product.avgRating;

    const pageData = { pageTitle: product.name, metaDescription: readSeo(product.seo).metaDescription };

    let html: string;
    if (product.layoutMode === "landing") {
      html = await renderPublic("landing", { ...pageData, rawHtml: product.description ?? "" });
    } else if (product.layoutMode === "custom") {
      html = await renderPublic("custom-content", { ...pageData, rawHtml: product.description ?? "" });
    } else {
      const base = await siteBaseUrl();
      const productUrl = new URL(`/products/${product.id}`, base).toString();
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", base).toString() },
        { name: "Sản phẩm", url: new URL("/products", base).toString() },
        ...(product.categories[0] ? [{ name: product.categories[0].name, url: new URL(`/products/danh-muc/${product.categories[0].slug}`, base).toString() }] : []),
        { name: product.name, url: productUrl },
      ];
      const schemas = [buildProductSchema(product, productUrl, reviews), buildBreadcrumbSchema(breadcrumbItems)];
      html = await renderPublic("product-detail", { ...pageData, product, variantsJson, reviews, avgRating, schemas });
    }

    return reply.type("text/html").send(html);
  });
}
