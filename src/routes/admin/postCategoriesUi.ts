import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerPostCategoriesUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/post-categories", { preHandler: requireRole("manager") }, async (request, reply) => {
    const html = await renderAdmin("post-categories", { role: request.session.get("role") });
    return reply.type("text/html").send(html);
  });
}
