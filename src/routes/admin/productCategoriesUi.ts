import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerProductCategoriesUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/product-categories", { preHandler: requireRole("manager") }, async (request, reply) => {
    const html = await renderAdmin("product-categories", {
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>(
    "/admin/product-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || category.type !== "product") {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy danh mục</h1>");
      }
      const html = await renderAdmin("product-category-edit", {
        category,
        userName: request.session.get("name"),
        role: request.session.get("role"),
        currentPath: request.url,
      });
      return reply.type("text/html").send(html);
    },
  );
}
