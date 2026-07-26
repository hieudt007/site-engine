import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";
import { ToolRegistry } from "../../agents/core/ToolRegistry.js";

export async function registerAgentsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/agents", { preHandler: requireRole("admin") }, async (request, reply) => {
    const allTools = ToolRegistry.getAllTools();
    const html = await renderAdmin("agents-list", {
      allTools,
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get<{ Querystring: { type?: string } }>(
    "/admin/agents/new",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
      // Tool/skill isSystem KHONG duoc hien de gan qua UI (chi gan duoc thang qua DB) - xem
      // ghi chu o MCPTool.isSystem va Agent.isSystem.
      const allTools = ToolRegistry.getAllTools().filter((t) => !t.isSystem);
      const allSkills = await prisma.agent.findMany({ where: { type: "skill", isSystem: false }, orderBy: { name: "asc" } });
      const html = await renderAdmin("agent-edit", {
        agent: null,
        defaultType: request.query.type === "skill" ? "skill" : "agent",
        aiProviderKeys: config?.aiProviderKeys || {},
        allTools,
        allSkills,
        userName: request.session.get("name"),
        role: request.session.get("role"),
        currentPath: request.url,
      });
      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy agent</h1>");
      }
      const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
      const allTools = ToolRegistry.getAllTools().filter((t) => !t.isSystem);
      const allSkills = await prisma.agent.findMany({ where: { type: "skill", isSystem: false }, orderBy: { name: "asc" } });
      // Tool/skill isSystem ma agent nay DA duoc gan san (qua DB, khong qua UI) - hien read-only +
      // giu nguyen khi luu form (xem agent-edit.liquid), khong duoc phep bo/them qua UI.
      const lockedTools = ToolRegistry.getAllTools().filter((t) => t.isSystem && agent.allowedTools.includes(t.name));
      const lockedSkills = await prisma.agent.findMany({
        where: { type: "skill", isSystem: true, key: { in: agent.allowedSkills } },
        orderBy: { name: "asc" },
      });
      const html = await renderAdmin("agent-edit", {
        agent,
        defaultType: agent.type,
        aiProviderKeys: config?.aiProviderKeys || {},
        allTools,
        allSkills,
        lockedTools,
        lockedSkills,
        userName: request.session.get("name"),
        role: request.session.get("role"),
        currentPath: request.url,
      });
      return reply.type("text/html").send(html);
    },
  );
}
