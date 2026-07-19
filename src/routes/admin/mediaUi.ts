import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerMediaUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/media", { preHandler: requireRole("edit") }, async (request, reply) => {
    const html = await renderAdmin("media-list", { role: request.session.get("role"), currentPath: request.url });
    return reply.type("text/html").send(html);
  });
}
