import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { renderPublic } from "../../services/themeRenderer.js";

const LATEST_POSTS = 3;
const LATEST_PRODUCTS = 6;

async function loadHomeData() {
  const [posts, products] = await Promise.all([
    prisma.post.findMany({
      where: { type: "post", status: "published" },
      orderBy: { publishedAt: "desc" },
      take: LATEST_POSTS,
      select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true },
    }),
    prisma.productCache.findMany({
      where: { status: "published" },
      orderBy: { syncedAt: "desc" },
      take: LATEST_PRODUCTS,
      select: { id: true, name: true, imageUrls: true, price: true, salePrice: true },
    }),
  ]);
  return { template: "home", data: { posts, products } };
}

// Moi mapping tra ve null neu CHUA co du lieu that phu hop (vd site chua co san pham nao) -
// route se tu fallback ve trang chu kem 1 cau ghi chu, KHONG bia du lieu gia (dung lai chinh
// field-select cua tung routes/public/*.ts that de dam bao dung hinh dang bien Liquid can, tranh
// doan sai gay loi render).
const LOADERS: Record<string, () => Promise<{ template: string; data: Record<string, unknown> } | null>> = {
  home: loadHomeData,

  "blog-list": async () => {
    const posts = await prisma.post.findMany({
      where: { type: "post", status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 10,
      select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true, categories: { select: { name: true, slug: true } } },
    });
    if (!posts.length) return null;
    return { template: "blog-list", data: { pageTitle: "Blog", posts, hasPrev: false, hasNext: false, prevPage: 0, nextPage: 2 } };
  },

  "blog-post": async () => {
    const post = await prisma.post.findFirst({
      where: { type: "post", status: "published" },
      orderBy: { publishedAt: "desc" },
      include: { categories: { select: { name: true, slug: true } } },
    });
    if (!post) return null;
    const template = post.layoutMode === "landing" ? "landing" : post.layoutMode === "custom" ? "custom-content" : "blog-post";
    const data = post.layoutMode === "landing" || post.layoutMode === "custom" ? { rawHtml: post.body } : { post };
    return { template, data: { pageTitle: post.title, ...data } };
  },

  "blog-category": async () => {
    const category = await prisma.category.findFirst({ where: { type: "post" }, include: { children: { select: { name: true, slug: true } } } });
    if (!category) return null;
    const posts = await prisma.post.findMany({
      where: { type: "post", status: "published", categories: { some: { id: category.id } } },
      orderBy: { publishedAt: "desc" },
      take: 10,
      select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true },
    });
    return { template: "blog-category", data: { pageTitle: category.name, category, posts, hasPrev: false, hasNext: false, prevPage: 0, nextPage: 2 } };
  },

  page: async () => {
    const page = await prisma.post.findFirst({ where: { type: "page", status: "published" } });
    if (!page) return null;
    const template = page.layoutMode === "landing" ? "landing" : page.layoutMode === "custom" ? "custom-content" : "page";
    const data = page.layoutMode === "landing" || page.layoutMode === "custom" ? { rawHtml: page.body } : { page };
    return { template, data: { pageTitle: page.title, ...data } };
  },

  "products-list": async () => {
    const products = await prisma.productCache.findMany({
      where: { status: "published" },
      orderBy: { syncedAt: "desc" },
      take: 12,
      include: { categories: { select: { name: true, slug: true } } },
    });
    if (!products.length) return null;
    return { template: "products-list", data: { pageTitle: "Sản phẩm", products, hasPrev: false, hasNext: false, prevPage: 0, nextPage: 2 } };
  },

  "product-category": async () => {
    const category = await prisma.category.findFirst({ where: { type: "product" }, include: { children: { select: { name: true, slug: true } } } });
    if (!category) return null;
    const products = await prisma.productCache.findMany({
      where: { status: "published", categories: { some: { id: category.id } } },
      orderBy: { syncedAt: "desc" },
      take: 12,
    });
    return { template: "product-category", data: { pageTitle: category.name, category, products, hasPrev: false, hasNext: false, prevPage: 0, nextPage: 2 } };
  },

  "product-detail": async () => {
    const product = await prisma.productCache.findFirst({
      where: { status: "published" },
      include: { variants: true, categories: { select: { name: true, slug: true } } },
    });
    if (!product) return null;
    const template = product.layoutMode === "landing" ? "landing" : product.layoutMode === "custom" ? "custom-content" : "product-detail";
    if (template !== "product-detail") {
      return { template, data: { pageTitle: product.name, rawHtml: product.description ?? "" } };
    }
    const variantsJson = JSON.stringify(product.variants).replace(/<\//g, "<\\/");
    const reviews = await prisma.productReview.findMany({ where: { productCacheId: product.id, status: "approved" }, orderBy: { createdAt: "desc" } });
    const avgRating = reviews.length ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : null;
    return { template: "product-detail", data: { pageTitle: product.name, product, variantsJson, reviews, avgRating } };
  },

  cart: async () => ({ template: "cart", data: { pageTitle: "Giỏ hàng" } }),

  "order-confirmation": async () => {
    const order = await prisma.cartOrder.findFirst({ orderBy: { createdAt: "desc" } });
    if (!order) return null;
    return { template: "order-confirmation", data: { pageTitle: "Đặt hàng thành công", order } };
  },

  404: async () => ({ template: "404", data: { pageTitle: "404", message: "Không tìm thấy trang bạn cần" } }),
};

// Xem truoc 1 LOAI TRANG cu the (khong chi trang chu) — bam vao file trong cay ben trai (theme
// editor) se doi preview sang dung loai trang su dung file do. Dung DU LIEU THAT dau tien tim
// duoc (khong bia) - loai nao chua co du lieu that (vd site moi chua co san pham) thi fallback
// ve trang chu, khong crash/trang trang.
export async function registerThemePreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/admin/themes/:slug/preview",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const customTheme = await prisma.customTheme.findUnique({ where: { slug: request.params.slug } });
      if (!customTheme) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy theme</h1>");
      }

      const key = request.query.page ?? "home";
      const loader = LOADERS[key] ?? loadHomeData;
      const result = (await loader()) ?? (await loadHomeData());

      const html = await renderPublic(result.template, result.data, request.params.slug);
      return reply.type("text/html").send(html);
    },
  );
}
