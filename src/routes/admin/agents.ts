import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { stripSystemResources } from "../../agents/core/agentPermissions.js";

const PROVIDERS = ["openai", "anthropic", "google", "deepseek", "openrouter", "ai-router", "custom"] as const;

// isSystem VA pluginSlug KHONG duoc phep trong schema nay - ca 2 quyet dinh agent co duoc dung
// tool/skill "isSystem" hay khong (xem src/agents/core/permissions.ts), NEU cho phep client tu
// gui thi admin (hoac session bi chiem) co the tu tick "isSystem" de mo khoa tool nhay cam (doc/
// ghi file...). 2 field nay CHI duoc set truc tiep qua prisma trong script seed/plugin install.ts,
// khong bao gio qua API cong khai nay - zod se tu am tham bo qua neu client co gui len.
const agentSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/).nullable().optional(),
  name: z.string().min(1),
  type: z.enum(["agent", "tool", "skill"]).optional().default("agent"),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
  systemPrompt: z.string().optional(),
  allowedTools: z.array(z.string()).optional().default([]),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  endpoint: z.string().optional(),
  isActive: z.boolean().optional(),
  // Chi dung khi type='skill': noi dung bi kip day du (systemPrompt o tren tai dung lam mo ta ngan).
  content: z.string().optional(),
  // Chi dung khi type='agent': cac skill.key duoc phep goi.
  allowedSkills: z.array(z.string()).optional().default([]),
});

const updateAgentSchema = agentSchema.partial();

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Agent", entityId, metadata },
  });
}

// CRUD cau hinh AI Agent — CHUA noi vao tinh nang nao, chi de dat truoc credentials/model se
// dung sau. Chi "admin" duoc dung (nam api key), khac Post/Page ("edit" tao duoc nhap mon).
export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { type?: string } }>("/admin/api/agents", { preHandler: requireRole("admin") }, async (request) => {
    const type = request.query.type === "skill" ? "skill" : "agent";
    const agents = await prisma.agent.findMany({ where: { type }, orderBy: { name: "asc" } });
    return { agents };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/api/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        return reply.code(404).send({ error: "Không tìm thấy agent" });
      }
      return { agent };
    },
  );

  app.post("/admin/api/agents", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = agentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const userId = request.session.get("userId")!;
    const cleanData = await stripSystemResources(parsed.data);
    const agent = await prisma.agent.create({ data: { ...cleanData, key: cleanData.key || null } });
    await auditLog(userId, "agent.create", agent.id);

    if (parsed.data.apiKey && parsed.data.apiKey.trim() !== "") {
      const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
      if (config) {
        const keys = (config.aiProviderKeys as Record<string, string> | null) || {};
        keys[parsed.data.provider] = parsed.data.apiKey;
        await prisma.siteConfig.update({ where: { id: "singleton" }, data: { aiProviderKeys: keys } });
      }
    }

    return reply.code(201).send({ agent });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = updateAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        return reply.code(404).send({ error: "Không tìm thấy agent" });
      }

      // apiKey de trong = giu key cu (khong ghi de rong) - giong pattern posts.ts update ban dau
      // giu nguyen field khong truyen, khac cho apiKey rong tu form vi form luon gui key rong khi
      // khong doi -> can loai truoc khi update.
      const cleanData = await stripSystemResources(parsed.data);
      const data = { ...cleanData, ...(cleanData.key !== undefined ? { key: cleanData.key || null } : {}) };
      if (data.apiKey === "") {
        delete data.apiKey;
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.agent.update({ where: { id: agent.id }, data });
      await auditLog(userId, "agent.update", agent.id);

      if (data.apiKey && data.apiKey.trim() !== "") {
        const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
        if (config) {
          const keys = (config.aiProviderKeys as Record<string, string> | null) || {};
          keys[data.provider || agent.provider] = data.apiKey;
          await prisma.siteConfig.update({ where: { id: "singleton" }, data: { aiProviderKeys: keys } });
        }
      }

      return { agent: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        return reply.code(404).send({ error: "Không tìm thấy agent" });
      }

      if (agent.isSystem) {
        return reply.code(400).send({ error: "Không thể xoá Agent hệ thống" });
      }

      if (agent.type === "tool") {
        return reply.code(403).send({ error: "Không thể xoá công cụ (Tool)" });
      }

      const userId = request.session.get("userId")!;
      await prisma.agent.delete({ where: { id: agent.id } });
      await auditLog(userId, "agent.delete", agent.id, { name: agent.name });

      return { success: true };
    },
  );
}
