import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db.js";
import { CacheService } from "../../services/CacheService.js";
import { renderPublic, renderPartial } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { buildProductSchema, buildBreadcrumbSchema } from "../../services/schema.js";
import { brandPath, productCategoryPath, productPath } from "../../services/urlPaths.js";
import { ensureProductSlug, ensureProductSlugs } from "../../services/productSlug.js";
import { getCrossSellProducts, getUpsellProducts } from "../../services/productRecommendations.js";

// URL tuyet doi cho JSON-LD (Product.url, BreadcrumbList.item...) - Schema.org yeu cau URL day du,
// khong chap nhan duong dan tuong doi.
async function siteBaseUrl(): Promise<string> {
  const siteConfig = await CacheService.getSiteConfig();
  const domain = siteConfig?.domain ?? "localhost";
  return domain.startsWith("http") ? domain : `https://${domain}`;
}

async function siteUrlConfig() {
  const config = await CacheService.getSiteConfig();
  return config as { postSlugPrefix?: string | null; productSlugPrefix?: string | null } | null;
}

const PAGE_SIZE = 12;

// 3 muc gia co dinh khop dung UI "Mức giá" cua products-list.liquid (duoi 500k / 500k-1tr / tren
// 1tr). Loc theo GIA THAT khach tra: san pham co salePrice thi dung salePrice, khong thi dung
// price - "OR" 2 nhanh vi Prisma khong ho tro COALESCE truc tiep trong where.
function priceRangeWhere(bucket: string | undefined): Record<string, unknown> {
  let min: number | undefined;
  let max: number | undefined;
  if (bucket === "under500") {
    max = 500_000;
  } else if (bucket === "500to1000") {
    min = 500_000;
    max = 1_000_000;
  } else if (bucket === "over1000") {
    min = 1_000_000;
  } else {
    return {};
  }

  const bounds = { ...(min != null ? { gte: min } : {}), ...(max != null ? { lte: max } : {}) };
  return {
    OR: [
      { salePrice: { not: null, ...bounds } },
      { salePrice: null, price: bounds },
    ],
  };
}

// Chỉ đọc ProductCache.status='published' (system_design.md §4.2/§8) — 'draft'/'pending_review'/
// 'scheduled' (chưa tới giờ) không lộ ra public. scheduled tự chuyển 'published' qua cron
// (services/publishScheduler.ts) nên ở đây chỉ cần lọc đúng 1 giá trị 'published'.
export async function registerProductsPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; price?: string } }>("/products", async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    // Loc theo GIA THAT KHACH TRA (salePrice neu co, khong thi price) - khong loc thang tren cot
    // "price" vi 1 san pham dang giam gia manh (vd gia goc 1.2tr, sale con 400k) phai duoc tinh la
    // "duoi 500k" theo cam nhan khach hang, khong phai theo gia niem yet cu.
    const priceFilter = request.query.price;
    const priceWhere = priceRangeWhere(priceFilter);

    const where = { status: "published", ...priceWhere };
    const [productsRaw, total] = await CacheService.getProductList(`all:${page}:${priceFilter ?? ""}`, async () => {
      return Promise.all([
        prisma.productCache.findMany({
          where,
          orderBy: { syncedAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { categories: { select: { name: true, slug: true } } },
        }),
        prisma.productCache.count({ where }),
      ]);
    });
    const products = await ensureProductSlugs(productsRaw as any);
    const categories = await prisma.category.findMany({
      where: { type: "product" },
      select: { name: true, slug: true, itemCount: true },
      orderBy: { name: "asc" },
    });
    const brands = await prisma.category.findMany({
      where: { type: "brand" },
      select: { name: true, slug: true, itemCount: true },
      orderBy: { name: "asc" },
    });

    const priceQuery = priceFilter ? `&price=${encodeURIComponent(priceFilter)}` : "";
    const html = await renderPublic("products-list", {
      pageTitle: "Sản phẩm",
      breadcrumbs: [
        { name: "Trang chủ", url: "/" },
        { name: "Sản phẩm", url: "/products" },
      ],
      breadcrumbVariant: "product",
      products,
      categories,
      brands,
      currentPrice: priceFilter ?? null,
      hasPrev: page > 1,
      hasNext: skip + products.length < total,
      prevPage: page - 1,
      nextPage: page + 1,
      currentPage: page,
      totalPages: Math.ceil(total / PAGE_SIZE),
      extraQuery: priceQuery,
    });

    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/product/danh-muc/:slug",
    async (request, reply) => {
      const allCategories = await CacheService.getCategories();
      const category = allCategories.find((c: any) => c.type === "product" && c.slug === request.params.slug);
      if (!category) {
        return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy danh mục"));
      }

      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const where = { status: "published", categories: { some: { id: category.id } } };

      const [productsRaw, total] = await CacheService.getProductList(`category:${category.slug}:${page}`, async () => {
        return Promise.all([
          prisma.productCache.findMany({ where, orderBy: { syncedAt: "desc" }, skip, take: PAGE_SIZE }),
          prisma.productCache.count({ where }),
        ]);
      });
      const products = await ensureProductSlugs(productsRaw as any);

      const seo = readSeo(category.seo);
      const base = await siteBaseUrl();
      const urlConfig = await siteUrlConfig();
      const categoryPath = productCategoryPath(urlConfig ?? {}, category.slug);
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", base).toString() },
        { name: "Sản phẩm", url: new URL("/products", base).toString() },
        { name: category.name, url: new URL(categoryPath, base).toString() },
      ];
      const html = await renderPublic("product-category", {
        pageTitle: seo.metaTitle ?? category.name,
        metaDescription: seo.metaDescription ?? category.excerpt ?? undefined,
        noindex: seo.noindex,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Sản phẩm", url: "/products" },
          { name: category.name, url: categoryPath },
        ],
        breadcrumbVariant: "product",
        category,
        categoryPath,
        backHref: "/products",
        backLabel: "Tất cả sản phẩm",
        childPathPrefix: productCategoryPath(urlConfig ?? {}, "").replace(/\/$/, ""),
        emptyText: "Chưa có sản phẩm nào trong danh mục này.",
        products,
        hasPrev: page > 1,
        hasNext: skip + products.length < total,
        prevPage: page - 1,
        nextPage: page + 1,
        currentPage: page,
        totalPages: Math.ceil(total / PAGE_SIZE),
        schemas: [buildBreadcrumbSchema(breadcrumbItems)],
      });

      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/products/danh-muc/:slug",
    async (request, reply) => reply.redirect(productCategoryPath((await siteUrlConfig()) ?? {}, request.params.slug)),
  );

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/product/thuong-hieu/:slug",
    async (request, reply) => {
      const allCategories = await CacheService.getCategories();
      const brand = allCategories.find((c: any) => c.type === "brand" && c.slug === request.params.slug);
      if (!brand) {
        return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy thương hiệu"));
      }

      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const where = { status: "published", brandId: brand.id };

      const [productsRaw, total] = await CacheService.getProductList(`brand:${brand.slug}:${page}`, async () => {
        return Promise.all([
          prisma.productCache.findMany({ where, orderBy: { syncedAt: "desc" }, skip, take: PAGE_SIZE }),
          prisma.productCache.count({ where }),
        ]);
      });
      const products = await ensureProductSlugs(productsRaw as any);

      const seo = readSeo(brand.seo);
      const base = await siteBaseUrl();
      const urlConfig = await siteUrlConfig();
      const categoryPath = brandPath(urlConfig ?? {}, brand.slug);
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", base).toString() },
        { name: "Sản phẩm", url: new URL("/products", base).toString() },
        { name: brand.name, url: new URL(categoryPath, base).toString() },
      ];
      const html = await renderPublic("product-category", {
        pageTitle: seo.metaTitle ?? brand.name,
        metaDescription: seo.metaDescription ?? brand.excerpt ?? undefined,
        noindex: seo.noindex,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Sản phẩm", url: "/products" },
          { name: brand.name, url: categoryPath },
        ],
        breadcrumbVariant: "product",
        category: brand,
        categoryPath,
        backHref: "/products",
        backLabel: "Tất cả sản phẩm",
        childPathPrefix: brandPath(urlConfig ?? {}, "").replace(/\/$/, ""),
        emptyText: "Chưa có sản phẩm nào thuộc thương hiệu này.",
        products,
        hasPrev: page > 1,
        hasNext: skip + products.length < total,
        prevPage: page - 1,
        nextPage: page + 1,
        currentPage: page,
        totalPages: Math.ceil(total / PAGE_SIZE),
        schemas: [buildBreadcrumbSchema(breadcrumbItems)],
      });

      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/products/thuong-hieu/:slug",
    async (request, reply) => reply.redirect(brandPath((await siteUrlConfig()) ?? {}, request.params.slug)),
  );

  const renderProductDetail = async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
    const product = await CacheService.getProductByIdOrSlug(request.params.slug);
    if (!product || product.status !== "published") {
      return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy sản phẩm"));
    }
    await ensureProductSlug(product as any);

    if ((product as any).slug && request.params.slug !== (product as any).slug) {
      return reply.redirect(productPath((await siteUrlConfig()) ?? {}, (product as any).slug));
    }

    const productSlug = ((product as any).slug as string | null | undefined) ?? product.id;

    // Escape "</" trước khi nhúng JSON vào <script> - tránh chuỗi thuộc tính variant (sku/attr)
    // vô tình chứa "</script>" phá vỡ thẻ script (an toàn hơn là tin dữ liệu đã lưu trong DB).
    const variantsJson = JSON.stringify(product.variants).replace(/<\//g, "<\\/");

    const reviews = await prisma.productReview.findMany({
      where: { productCacheId: product.id, status: "approved" },
      orderBy: { createdAt: "desc" },
    });
    // avgRating/reviewCount doc thang tu ProductCache (denormalize san - xem
    // services/productRatingAggregate.ts) thay vi tu tinh lai moi request - reviews[] van can fetch
    // rieng vi trang nay con hien TUNG binh luan, khong chi con so trung binh.
    const avgRating = product.avgRating;

    const seo = readSeo(product.seo);
    const pageData = { pageTitle: seo.metaTitle || product.name, metaDescription: seo.metaDescription || undefined };

    let html: string;
    if (product.layoutMode === "landing") {
      html = await renderPublic("landing", { ...pageData, rawHtml: product.description ?? "" });
    } else if (product.layoutMode === "custom") {
      html = await renderPublic("custom-content", { ...pageData, rawHtml: product.description ?? "" });
    } else {
      const base = await siteBaseUrl();
      const urlConfig = await siteUrlConfig();
      const productUrl = new URL(productPath(urlConfig ?? {}, productSlug), base).toString();
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", base).toString() },
        { name: "Sản phẩm", url: new URL("/products", base).toString() },
        ...(product.categories[0] ? [{ name: product.categories[0].name, url: new URL(productCategoryPath(urlConfig ?? {}, product.categories[0].slug), base).toString() }] : []),
        { name: product.name, url: productUrl },
      ];
      const [upsellProducts, crossSellProducts] = await Promise.all([
        getUpsellProducts(product, product.relatedProducts),
        getCrossSellProducts(product.relatedProducts, product.id),
      ]);

      const schemas = [buildProductSchema(product, productUrl, reviews), buildBreadcrumbSchema(breadcrumbItems)];
      html = await renderPublic("product-detail", {
        ...pageData,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Sản phẩm", url: "/products" },
          ...(product.categories[0] ? [{ name: product.categories[0].name, url: productCategoryPath(urlConfig ?? {}, product.categories[0].slug) }] : []),
          { name: product.name, url: productPath(urlConfig ?? {}, productSlug) },
        ],
        breadcrumbVariant: "product",
        product,
        variantsJson,
        reviews,
        avgRating,
        schemas,
        upsellProducts,
        crossSellProducts,
      });
    }

    return reply.type("text/html").send(html);
  };

  app.get<{ Params: { slug: string } }>("/product/:slug", renderProductDetail);
  app.get<{ Params: { slug: string } }>("/products/:slug", async (request, reply) => reply.redirect(productPath((await siteUrlConfig()) ?? {}, request.params.slug)));

  app.get<{ Params: { id: string }, Querystring: { excludeIds?: string } }>("/api/public/products/:id/related", async (request, reply) => {
    const product = await prisma.productCache.findUnique({ where: { id: request.params.id }, include: { categories: { select: { id: true, name: true, slug: true } } } });
    if (!product) return reply.status(404).send("");

    const excludeIds = request.query.excludeIds ? request.query.excludeIds.split(",").filter(Boolean) : [];
    const upsellProducts = await getUpsellProducts(product, product.relatedProducts, excludeIds);

    if (upsellProducts.length === 0) return reply.send("");

    const urlConfig = await siteUrlConfig();
    const productUrlPrefix = urlConfig?.productSlugPrefix ? `/${urlConfig.productSlugPrefix}` : "/product";

    let html = "";
    for (const prod of upsellProducts) {
      html += await renderPartial("components/product/card", { product: prod, productUrlPrefix, variant: "related" });
    }
    return reply.type("text/html").send(html);
  });
}
