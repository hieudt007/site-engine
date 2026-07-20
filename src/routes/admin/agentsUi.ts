import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerAgentsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/agents", { preHandler: requireRole("admin") }, async (request, reply) => {
    const html = await renderAdmin("agents-list", {
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get("/admin/agents/new", { preHandler: requireRole("admin") }, async (request, reply) => {
    const html = await renderAdmin("agent-edit", {
      agent: null,
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>(
    "/admin/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy agent</h1>");
      }
      const html = await renderAdmin("agent-edit", {
        agent,
        userName: request.session.get("name"),
        role: request.session.get("role"),
        currentPath: request.url,
      });
      return reply.type("text/html").send(html);
    },
  );
}
