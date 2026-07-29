import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";
import { ToolRegistry, MCPTool } from "../../agents/core/ToolRegistry.js";
import { toolLabelVi } from "../../agents/tools/toolLabels.js";

// Gan "label" (ten tieng Viet, chi de HIEN THI) len tung tool truoc khi render - khong dung trong
// "name" thuc gui cho AI, xem toolLabels.ts.
function withLabel(tools: MCPTool[]): (MCPTool & { label: string })[] {
  return tools.map((t) => ({ ...t, label: toolLabelVi(t.name) }));
}

// Dua muc DANG BAT (co trong "allowed") len dau danh sach - de admin thay ngay cau hinh hien tai
// cua agent khong phai cuon het qua danh sach dai moi thay. Partition on-dinh (filter+concat), giu
// nguyen thu tu tuong doi trong tung nhom.
function sortChecked<T>(items: T[], getKey: (item: T) => string, allowed: string[]): T[] {
  const on = items.filter((i) => allowed.includes(getKey(i)));
  const off = items.filter((i) => !allowed.includes(getKey(i)));
  return [...on, ...off];
}

export async function registerAgentsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/agents", { preHandler: requireRole("admin") }, async (request, reply) => {
    const allTools = withLabel(ToolRegistry.getAllTools());
    const skillAssignableTools = withLabel(ToolRegistry.getAllTools().filter((t) => !t.isSystem));
    // Tool config that qua API ngoai (goi endpoint /search, /web/fetch, /images/generations,
    // /videos/generations, /embeddings cua 9Router) - luu duoi dang Agent row rieng type="tool"
    // (seedAgents.ts), khac voi allTools o tren la danh sach tool CODE lap trinh cung. Nhung tool
    // nay CO the sua qua popup (tool-config-modal.liquid), khong chi doc.
    const dbTools = await prisma.agent.findMany({ where: { type: "tool" }, orderBy: { name: "asc" } });
    const html = await renderAdmin("agents-list", {
      allTools,
      skillAssignableTools,
      dbTools,
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
      const allTools = withLabel(ToolRegistry.getAllTools().filter((t) => !t.isSystem));
      const skillAssignableTools = allTools;
      const allSkills = await prisma.agent.findMany({ where: { type: "skill", isSystem: false }, orderBy: { name: "asc" } });
      const allAgents = await prisma.agent.findMany({ where: { type: "agent", isSystem: false }, orderBy: { name: "asc" } });
      const html = await renderAdmin("agent-edit", {
        agent: null,
        defaultType: request.query.type === "skill" ? "skill" : "agent",
        aiProviderKeys: config?.aiProviderKeys || {},
        allTools,
        skillAssignableTools,
        allSkills,
        allAgents,
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
      let allTools = withLabel(ToolRegistry.getAllTools().filter((t) => !t.isSystem));
      const skillAssignableTools = allTools;
      let allSkills = await prisma.agent.findMany({ where: { type: "skill", isSystem: false }, orderBy: { name: "asc" } });
      let allAgents = await prisma.agent.findMany({ where: { type: "agent", isSystem: false, id: { not: agent.id } }, orderBy: { name: "asc" } });
      // Muc dang bat (co trong allowedX cua agent nay) len dau danh sach - xem sortChecked().
      allTools = sortChecked(allTools, (t) => t.name, agent.allowedTools);
      allSkills = sortChecked(allSkills, (s) => s.key || "", agent.allowedSkills);
      allAgents = sortChecked(allAgents, (a) => a.key || "", agent.allowedAgents);
      // Tool/skill isSystem ma agent nay DA duoc gan san (qua DB, khong qua UI) - hien read-only +
      // giu nguyen khi luu form (xem agent-edit.liquid), khong duoc phep bo/them qua UI.
      const lockedTools = withLabel(ToolRegistry.getAllTools().filter((t) => t.isSystem && agent.allowedTools.includes(t.name)));
      const lockedSkills = await prisma.agent.findMany({
        where: { type: "skill", isSystem: true, key: { in: agent.allowedSkills } },
        orderBy: { name: "asc" },
      });
      const lockedAgents = await prisma.agent.findMany({
        where: { type: "agent", isSystem: true, key: { in: agent.allowedAgents } },
        orderBy: { name: "asc" },
      });
      const html = await renderAdmin("agent-edit", {
        agent,
        defaultType: agent.type,
        aiProviderKeys: config?.aiProviderKeys || {},
        allTools,
        skillAssignableTools,
        allSkills,
        allAgents,
        lockedTools,
        lockedSkills,
        lockedAgents,
        userName: request.session.get("name"),
        role: request.session.get("role"),
        currentPath: request.url,
      });
      return reply.type("text/html").send(html);
    },
  );
}
