import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

import { prisma } from "../../db.js";
import { AutomationRegistry } from "../../jobs/AutomationRegistry.js";

export async function registerAutomationsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/automations", { preHandler: requireRole("manager") }, async (request, reply) => {
    const allAgents = await prisma.agent.findMany({
      where: { type: "agent", isActive: true },
      select: { id: true, name: true, key: true }
    });

    const html = await renderAdmin("automations", {
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
      agents: allAgents,
      functions: Object.keys(AutomationRegistry),
    });
    return reply.type("text/html").send(html);
  });
}
