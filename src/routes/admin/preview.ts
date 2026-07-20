import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";

// Xem thử bài viết/trang/sản phẩm CHƯA xuất bản (draft/pending_review/scheduled) — trước đây
// chỉ xem được nội dung thô trong khung soạn thảo, không thấy được giao diện public thật. Render
// LẠI ĐÚNG template public (renderPublic) nhưng bỏ qua điều kiện status='published' và yêu cầu
// đăng nhập admin thay cho cookie mật khẩu (post.password bỏ qua trong preview vì admin đã thấy
// nội dung ngay trong form soạn rồi, không cần khoá thêm lớp nữa).
export async function registerPreviewRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/admin/preview/post/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
        include: { categories: { select: { name: true, slug: true } } },
      });
      if (!post || post.type !== "post") {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy bài viết</h1>");
      }

      const seo = readSeo(post.seo);
      const pageData = { pageTitle: `[Xem thử] ${post.title}`, metaDescription: seo.metaDescription ?? post.excerpt ?? undefined, noindex: true };

      let html: string;
      if (post.layoutMode === "landing") {
        html = await renderPublic("landing", { ...pageData, rawHtml: post.body });
      } else if (post.layoutMode === "custom") {
        html = await renderPublic("custom-content", { ...pageData, rawHtml: post.body });
      } else {
        html = await renderPublic("blog-post", { ...pageData, post });
      }
      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/preview/page/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== "page") {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
      }

      const seo = readSeo(page.seo);
      const pageData = { pageTitle: `[Xem thử] ${page.title}`, metaDescription: seo.metaDescription ?? page.excerpt ?? undefined, noindex: true };

      let html: string;
      if (page.layoutMode === "landing") {
        html = await renderPublic("landing", { ...pageData, rawHtml: page.body });
      } else if (page.layoutMode === "custom") {
        html = await renderPublic("custom-content", { ...pageData, rawHtml: page.body });
      } else {
        html = await renderPublic("page", { ...pageData, page });
      }
      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/preview/product/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({
        where: { id: request.params.id },
        include: { variants: true, categories: { select: { name: true, slug: true } } },
      });
      if (!product) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy sản phẩm</h1>");
      }

      const variantsJson = JSON.stringify(product.variants).replace(/<\//g, "<\\/");
      const reviews = await prisma.productReview.findMany({
        where: { productCacheId: product.id, status: "approved" },
        orderBy: { createdAt: "desc" },
      });
      const avgRating = reviews.length
        ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
        : null;

      const pageData = { pageTitle: `[Xem thử] ${product.name}`, metaDescription: readSeo(product.seo).metaDescription, noindex: true };

      let html: string;
      if (product.layoutMode === "landing") {
        html = await renderPublic("landing", { ...pageData, rawHtml: product.description ?? "" });
      } else if (product.layoutMode === "custom") {
        html = await renderPublic("custom-content", { ...pageData, rawHtml: product.description ?? "" });
      } else {
        html = await renderPublic("product-detail", { ...pageData, product, variantsJson, reviews, avgRating });
      }
      return reply.type("text/html").send(html);
    },
  );
}
