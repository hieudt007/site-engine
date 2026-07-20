import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";

// Route public cho Page (trang tĩnh) — chỉ hiện trang status='published', cùng pattern với
// routes/public/blog.ts. KHÔNG yêu cầu đăng nhập, khác /admin/pages (quản trị nội bộ).
export async function registerPagesPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/trang/:slug", async (request, reply) => {
    const page = await prisma.post.findUnique({
      where: { type_slug: { type: "page", slug: request.params.slug } },
    });
    if (!page || page.status !== "published") {
      // "/trang/:slug" là route ĐÃ ĐĂNG KÝ nên luôn khớp pattern - app.setNotFoundHandler()
      // (server.ts) KHÔNG BAO GIỜ chạy tới đây, phải tự trả Redirect ngay trong handler này
      // (khác các path hoàn toàn không tồn tại, mới rơi xuống setNotFoundHandler thật).
      const redirect = await prisma.redirect.findUnique({ where: { fromPath: request.url } });
      if (redirect) {
        return reply.code(redirect.statusCode).redirect(redirect.toPath);
      }
      return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
    }

    const seo = readSeo(page.seo);
    const html = await renderPublic("page", {
      pageTitle: page.title,
      metaDescription: seo.metaDescription ?? page.excerpt ?? undefined,
      noindex: seo.noindex,
      page,
    });

    return reply.type("text/html").send(html);
  });
}
