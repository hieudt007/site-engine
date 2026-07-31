import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { CacheService } from "../../services/CacheService.js";
import { requireRole } from "../../plugins/requireRole.js";
import { stripSystemResources } from "../../agents/core/agentPermissions.js";
import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from "../../security/ssrfGuard.js";

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
  // So lan lap toi da cua BaseAgent.run() - rieng cho agent nay, xem prisma/schema.prisma.
  maxLoops: z.number().int().min(1).max(50).optional(),
  // Chi dung khi type='skill': noi dung bi kip day du (systemPrompt o tren tai dung lam mo ta ngan).
  content: z.string().optional(),
  // Chi dung khi type='agent': cac skill.key duoc phep goi.
  allowedSkills: z.array(z.string()).optional().default([]),
  // Chi dung khi type='agent': cac agent.key duoc phep goi (sub-agents).
  allowedAgents: z.array(z.string()).optional().default([]),
  // Tham so phu khi goi provider (gop chung 1 cot Json, xem prisma/schema.prisma comment tren
  // Agent.settings va aiClient.ts: getAgentSettings()). "stream" chi co ich khi agent nay duoc goi
  // tu noi co context.reply (SSE).
  settings: z
    .object({
      stream: z.boolean().optional(),
      max_tokens: z.number().int().positive().optional(),
      temperature: z.number().min(0).max(2).optional(),
      // Rieng agent endpoint="/search" (xem aiClient.ts: webSearch()).
      search_type: z.enum(["news", "web"]).optional(),
      max_results: z.number().int().positive().optional(),
      country: z.string().optional(),
      language: z.string().optional(),
      // Rieng agent endpoint="/web/fetch" (xem aiClient.ts: webFetch()).
      format: z.enum(["markdown", "text", "html"]).optional(),
      max_chars: z.number().int().min(0).optional(),
      // Rieng agent endpoint="/images/generations" (xem aiClient.ts: generateImage()).
      n: z.number().int().positive().optional(),
      output_format: z.string().optional(),
      // Rieng agent endpoint="/embeddings" (xem aiClient.ts: createEmbedding()).
      dimensions: z.number().int().positive().optional(),
    })
    .optional(),
});

const updateAgentSchema = agentSchema.partial();

// Agent.baseUrl la INPUT NGUOI DUNG (admin nhap qua form nay) - server se TU GOI toi dung URL nay
// kem apiKey trong header (xem agents/core/aiClient.ts: resolveBaseUrl()/fetch()). Phai chan SSRF
// NGAY LUC LUU (bao loi som cho admin thay) - aiClient.ts tu kiem tra LAI lan nua ngay truoc khi
// fetch() that (phong DNS doi sau khi luu / TOCTOU).
async function assertBaseUrlSafe(baseUrl: string | undefined | null): Promise<string | null> {
  if (!baseUrl) return null;
  try {
    await assertSafeOutboundUrl(baseUrl);
    return null;
  } catch (err) {
    return err instanceof UnsafeOutboundUrlError ? err.message : "baseUrl không hợp lệ.";
  }
}

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Agent", entityId, metadata },
  });
}

// CRUD cau hinh AI Agent — CHUA noi vao tinh nang nao, chi de dat truoc credentials/model se
// dung sau. Chi "admin" duoc dung (nam api key), khac Post/Page ("edit" tao duoc nhap mon).
export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { type?: string } }>("/admin/api/agents", { preHandler: requireRole("admin") }, async (request) => {
    const type = request.query.type === "skill" ? "skill" : request.query.type === "tool" ? "tool" : "agent";
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

    const baseUrlError = await assertBaseUrlSafe(parsed.data.baseUrl);
    if (baseUrlError) {
      return reply.code(422).send({ error: { fieldErrors: { baseUrl: [baseUrlError] } } });
    }

    const userId = request.session.get("userId")!;
    const cleanData = await stripSystemResources(parsed.data);
    const agent = await prisma.agent.create({ data: { ...cleanData, key: cleanData.key || null } });
    await CacheService.forget('global:agents');
    await auditLog(userId, "agent.create", agent.id);

    if (parsed.data.apiKey && parsed.data.apiKey.trim() !== "") {
      const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
      if (config) {
        const keys = (config.aiProviderKeys as Record<string, string> | null) || {};
        keys[parsed.data.provider] = parsed.data.apiKey;
        await prisma.siteConfig.update({ where: { id: "singleton" }, data: { aiProviderKeys: keys } });
        await CacheService.forget('global:site_config');
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

      const baseUrlError = await assertBaseUrlSafe(parsed.data.baseUrl);
      if (baseUrlError) {
        return reply.code(422).send({ error: { fieldErrors: { baseUrl: [baseUrlError] } } });
      }

      const agent = await prisma.agent.findUnique({ where: { id: request.params.id } });
      if (!agent) {
        return reply.code(404).send({ error: "Không tìm thấy agent" });
      }

      const cleanData = await stripSystemResources(parsed.data);
      const data = { ...cleanData, ...(cleanData.key !== undefined ? { key: cleanData.key || null } : {}) };
      if (data.apiKey === "") {
        delete data.apiKey;
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.agent.update({ where: { id: agent.id }, data });
      await CacheService.forget('global:agents');
      await auditLog(userId, "agent.update", agent.id);

      if (data.apiKey && data.apiKey.trim() !== "") {
        const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
        if (config) {
          const keys = (config.aiProviderKeys as Record<string, string> | null) || {};
          keys[data.provider || agent.provider] = data.apiKey;
          await prisma.siteConfig.update({ where: { id: "singleton" }, data: { aiProviderKeys: keys } });
          await CacheService.forget('global:site_config');
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
      await CacheService.forget('global:agents');
      await auditLog(userId, "agent.delete", agent.id, { name: agent.name });

      return { success: true };
    },
  );
}
