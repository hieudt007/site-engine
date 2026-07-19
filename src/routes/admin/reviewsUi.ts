import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerReviewsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/reviews", { preHandler: requireRole("manager") }, async (request, reply) => {
    const html = await renderAdmin("reviews-list", { role: request.session.get("role") });
    return reply.type("text/html").send(html);
  });
}
