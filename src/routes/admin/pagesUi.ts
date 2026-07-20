import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

// Trang HTML danh sách/soạn trang tĩnh trong /admin — gọi JSON API ở /admin/api/pages/* bằng
// fetch() phía client, cùng pattern với postsUi.ts.
export async function registerPagesUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/pages", { preHandler: requireRole("edit") }, async (request, reply) => {
    const html = await renderAdmin("pages-list", {
      userName: request.session.get("name"), role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get("/admin/pages/new", { preHandler: requireRole("edit") }, async (request, reply) => {
    const html = await renderAdmin("page-edit", { page: null, userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>(
    "/admin/pages/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
      }
      const html = await renderAdmin("page-edit", { page, userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );
}
