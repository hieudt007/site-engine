import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerSettingsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/settings/general",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const html = await renderAdmin("settings-general", { role: request.session.get("role") });
      return reply.type("text/html").send(html);
    },
  );
}
