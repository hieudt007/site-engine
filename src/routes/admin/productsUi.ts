import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

// Trang HTML danh sách/sửa sản phẩm — chỉ manager/admin (§5.2), role "edit" bị chặn ở
// requireRole("manager") ngay từ middleware, không cần check thêm trong handler.
export async function registerProductsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/products", { preHandler: requireRole("manager") }, async (request, reply) => {
    const categories = await prisma.category.findMany({ where: { type: "product" }, orderBy: { name: "asc" } });
    const html = await renderAdmin("products-list", {
      categories,
      userName: request.session.get("name"), role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>(
    "/admin/products/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({
        where: { id: request.params.id },
        include: { variants: true, categories: true },
      });
      if (!product) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy sản phẩm</h1>");
      }
      const html = await renderAdmin("product-edit", { product, userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );
}
