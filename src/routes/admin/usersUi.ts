import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerUsersUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/users", { preHandler: requireRole("admin") }, async (request, reply) => {
    const html = await renderAdmin("users-list", {
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });
}
