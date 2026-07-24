import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerAdminFormsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/forms", { preHandler: requireRole("edit") }, async (request, reply) => {
    const html = await renderAdmin("forms-list", {
      pageTitle: "Danh sách khách hàng (Lead Form)",
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });
}
