import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

const PROVIDERS = ["openai", "anthropic", "google", "deepseek", "openrouter", "ai-router", "custom"] as const;
const PURPOSES = ["content", "design"] as const;

const agentSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/).nullable().optional(),
  name: z.string().min(1),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
  systemPrompt: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  purpose: z.enum(PURPOSES).nullable().optional(),
  isActive: z.boolean().optional(),
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
  app.get("/admin/api/agents", { preHandler: requireRole("admin") }, async () => {
    const agents = await prisma.agent.findMany({ orderBy: { name: "asc" } });
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
    const agent = await prisma.agent.create({ data: { ...parsed.data, key: parsed.data.key || null } });
    await auditLog(userId, "agent.create", agent.id);

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
      const data = { ...parsed.data, ...(parsed.data.key !== undefined ? { key: parsed.data.key || null } : {}) };
      if (data.apiKey === "") {
        delete data.apiKey;
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.agent.update({ where: { id: agent.id }, data });
      await auditLog(userId, "agent.update", agent.id);

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

      const userId = request.session.get("userId")!;
      await prisma.agent.delete({ where: { id: agent.id } });
      await auditLog(userId, "agent.delete", agent.id, { name: agent.name });

      return { success: true };
    },
  );
}
