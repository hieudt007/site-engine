import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerOrdersUiRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { status?: string } }>(
    "/admin/orders",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const html = await renderAdmin("orders-list", {
        userName: request.session.get("name"), role: request.session.get("role"),
        currentPath: request.url,
        initialStatus: request.query.status ?? "",
      });
      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/orders/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const order = await prisma.cartOrder.findUnique({ where: { id: request.params.id } });
      if (!order) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy đơn hàng</h1>");
      }
      const html = await renderAdmin("order-detail", {
        order,
        userName: request.session.get("name"), role: request.session.get("role"),
        currentPath: request.url,
      });
      return reply.type("text/html").send(html);
    },
  );
}
