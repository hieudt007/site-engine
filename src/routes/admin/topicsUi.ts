import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerTopicsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/topics", { preHandler: requireRole("manager") }, async (request, reply) => {
    const html = await renderAdmin("topics", {
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });
}
