import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";

// Route public cho Page (trang tĩnh) — chỉ hiện trang đã publishedAt, cùng pattern với
// routes/public/blog.ts. KHÔNG yêu cầu đăng nhập, khác /admin/pages (quản trị nội bộ).
export async function registerPagesPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/trang/:slug", async (request, reply) => {
    const page = await prisma.page.findUnique({ where: { slug: request.params.slug } });
    if (!page || !page.publishedAt) {
      // "/trang/:slug" là route ĐÃ ĐĂNG KÝ nên luôn khớp pattern - app.setNotFoundHandler()
      // (server.ts) KHÔNG BAO GIỜ chạy tới đây, phải tự trả Redirect ngay trong handler này
      // (khác các path hoàn toàn không tồn tại, mới rơi xuống setNotFoundHandler thật).
      const redirect = await prisma.redirect.findUnique({ where: { fromPath: request.url } });
      if (redirect) {
        return reply.code(redirect.statusCode).redirect(redirect.toPath);
      }
      return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
    }

    const html = await renderPublic("page", {
      pageTitle: page.title,
      metaDescription: page.metaDescription ?? page.excerpt ?? undefined,
      noindex: page.noindex,
      page,
    });

    return reply.type("text/html").send(html);
  });
}
