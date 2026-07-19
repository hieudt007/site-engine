import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerRedirectsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/redirects", { preHandler: requireRole("manager") }, async (request, reply) => {
    const html = await renderAdmin("redirects-list", { role: request.session.get("role") });
    return reply.type("text/html").send(html);
  });
}
