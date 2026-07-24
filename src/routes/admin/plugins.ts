import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { AiCallError, callAgent } from "../../services/aiClient.js";
import { renderAdmin } from "../../services/adminView.js";
import {
  READABLE_CORE_MODELS,
  assertCollectionAllowed,
  findEnabledPlugin,
  manifestOf,
  pluginManifestSchema,
  publicActionOf,
  readCoreModel,
  type ReadableCoreModel,
  validatePublicActionData,
} from "../../services/pluginRuntime.js";

const importSchema = z.object({
  manifest: pluginManifestSchema,
  mode: z.enum(["create", "update"]).default("create"),
  enabled: z.boolean().default(false),
});

const agentSchema = z.object({
  key: z.string().optional().nullable(),
  name: z.string().min(1),
  provider: z.string().default("openai"),
  model: z.string().min(1),
  systemPrompt: z.string().optional().nullable(),
  apiKey: z.string().optional().nullable(),
  baseUrl: z.string().optional().nullable(),
  endpoint: z.string().default("/chat/completions"),
  isActive: z.boolean().default(true),
});

const enabledSchema = z.object({ enabled: z.boolean() });
const recordSchema = z.object({ data: z.record(z.unknown()) });
const collectionParamSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,48}$/);
const aiCallSchema = z.object({
  agentKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  prompt: z.string().min(1),
});

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Plugin", entityId, metadata },
  });
}

export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>(
    "/admin/api/plugins/:slug/agents",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const agents = await prisma.agent.findMany({ where: { pluginSlug: plugin.slug } });
      return { agents };
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/admin/api/plugins/:slug/agents",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const parsed = agentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });
      const agent = await prisma.agent.create({
        data: { ...parsed.data, pluginSlug: plugin.slug, isSystem: false },
      });
      return reply.code(201).send({ agent });
    },
  );

  app.put<{ Params: { slug: string; id: string } }>(
    "/admin/api/plugins/:slug/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const agent = await prisma.agent.findFirst({ where: { id: request.params.id, pluginSlug: plugin.slug } });
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      const parsed = agentSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });
      const updated = await prisma.agent.update({
        where: { id: agent.id },
        data: { ...parsed.data, isSystem: false },
      });
      return { agent: updated };
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    "/admin/api/plugins/:slug/agents/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const agent = await prisma.agent.findFirst({ where: { id: request.params.id, pluginSlug: plugin.slug } });
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
      await prisma.agent.delete({ where: { id: agent.id } });
      return { success: true };
    },
  );
  app.post<{ Params: { slug: string; action: string } }>("/api/plugins/:slug/actions/:action", async (request, reply) => {
    const plugin = await findEnabledPlugin(request.params.slug);
    if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });

    const action = publicActionOf(plugin, request.params.action);
    if (!action) return reply.code(404).send({ error: "Public action not found" });

    const parsed = validatePublicActionData(action, request.body);
    if (!parsed.ok) return reply.code(422).send({ error: parsed.error });

    await prisma.pluginRecord.create({
      data: {
        pluginSlug: plugin.slug,
        collection: action.collection,
        data: { ...parsed.data, _action: action.key, _source: "public" } as Prisma.InputJsonValue,
      },
    });

    return reply.code(201).send({ success: true, message: action.successMessage ?? "Submitted." });
  });

  app.get("/admin/plugins", { preHandler: requireRole("admin") }, async (request, reply) => {
    const html = await renderAdmin("plugins-list", {
      pageTitle: "Plugins",
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { slug: string; page: string } }>(
    "/admin/plugins/:slug/:page",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).type("text/html").send("<h1>404 - Plugin not found</h1>");

      const manifest = manifestOf(plugin);
      const page = manifest.adminPages.find((item) => item.path === request.params.page);
      if (!page) return reply.code(404).type("text/html").send("<h1>404 - Plugin page not found</h1>");

      const records = await Promise.all(
        manifest.collections.map(async (collection) => ({
          ...collection,
          count: await prisma.pluginRecord.count({ where: { pluginSlug: plugin.slug, collection: collection.name } }),
        })),
      );

      const html = await renderAdmin("plugin-page", {
        pageTitle: page.title,
        userName: request.session.get("name"),
        role: request.session.get("role"),
        currentPath: request.url,
        plugin,
        manifest,
        page,
        records,
      });
      return reply.type("text/html").send(html);
    },
  );

  app.get("/admin/api/plugins", { preHandler: requireRole("admin") }, async () => {
    const plugins = await prisma.plugin.findMany({ orderBy: { installedAt: "desc" } });
    return { plugins };
  });

  app.post<{ Params: { slug: string } }>("/admin/api/plugins/:slug/ai", { preHandler: requireRole("admin") }, async (request, reply) => {
    const plugin = await findEnabledPlugin(request.params.slug);
    if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });

    const manifest = manifestOf(plugin);
    const aiPermission = manifest.permissions.ai;
    if (!aiPermission?.enabled) return reply.code(403).send({ error: "Plugin cannot call AI" });

    const parsed = aiCallSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });
    const agent = await prisma.agent.findUnique({ where: { key: parsed.data.agentKey } });
    if (!agent || !agent.isActive) return reply.code(404).send({ error: "Active agent not found" });

    if (agent.pluginSlug !== plugin.slug) {
      return reply.code(403).send({ error: "Plugin can only call its own agents" });
    }

    if (parsed.data.prompt.length > aiPermission.maxPromptLength) {
      return reply.code(422).send({ error: "Prompt is too long" });
    }

    try {
      const text = await callAgent(agent, aiPermission.systemPrompt ?? "You are an assistant used by an admin plugin. Return a concise, useful answer.", parsed.data.prompt);
      await auditLog(request.session.get("userId")!, "plugin.ai.call", plugin.slug, { agentKey: agent.key, agentId: agent.id });
      return { text, agent: { key: agent.key, name: agent.name, model: agent.model, provider: agent.provider } };
    } catch (err) {
      if (err instanceof AiCallError) return reply.code(502).send({ error: err.message });
      throw err;
    }
  });

  app.post("/admin/api/plugins/import", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

    const { manifest, mode, enabled } = parsed.data;
    const existing = await prisma.plugin.findUnique({ where: { slug: manifest.slug } });
    if (mode === "create" && existing) return reply.code(409).send({ error: "Plugin already exists." });
    if (mode === "update" && !existing) return reply.code(404).send({ error: "Plugin not found for update." });

    const userId = request.session.get("userId")!;
    const plugin = await prisma.plugin.upsert({
      where: { slug: manifest.slug },
      create: { slug: manifest.slug, name: manifest.name, version: manifest.version, enabled, manifest },
      update: { name: manifest.name, version: manifest.version, manifest, enabled: mode === "create" ? enabled : existing?.enabled ?? enabled },
    });
    await auditLog(userId, mode === "create" ? "plugin.import" : "plugin.update", plugin.slug, { version: plugin.version });
    return reply.code(mode === "create" ? 201 : 200).send({ plugin });
  });

  app.patch<{ Params: { slug: string } }>(
    "/admin/api/plugins/:slug/enabled",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = enabledSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

      const plugin = await prisma.plugin.findUnique({ where: { slug: request.params.slug } });
      if (!plugin) return reply.code(404).send({ error: "Plugin not found" });

      const updated = await prisma.plugin.update({ where: { slug: plugin.slug }, data: { enabled: parsed.data.enabled } });
      await auditLog(request.session.get("userId")!, parsed.data.enabled ? "plugin.enable" : "plugin.disable", plugin.slug);
      return { plugin: updated };
    },
  );

  app.delete<{ Params: { slug: string } }>(
    "/admin/api/plugins/:slug",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await prisma.plugin.findUnique({ where: { slug: request.params.slug } });
      if (!plugin) return reply.code(404).send({ error: "Plugin not found" });
      await prisma.plugin.delete({ where: { slug: plugin.slug } });
      await auditLog(request.session.get("userId")!, "plugin.delete", plugin.slug, { name: plugin.name });
      return { success: true };
    },
  );

  app.get<{ Params: { slug: string; model: ReadableCoreModel } }>(
    "/admin/api/plugins/:slug/core/:model",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const manifest = manifestOf(plugin);
      if (!manifest.permissions.readModels.includes(request.params.model)) {
        return reply.code(403).send({ error: "Plugin cannot read this core model" });
      }
      return { model: request.params.model, rows: await readCoreModel(request.params.model) };
    },
  );

  app.get<{ Params: { slug: string; collection: string } }>(
    "/admin/api/plugins/:slug/records/:collection",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const collection = collectionParamSchema.parse(request.params.collection);
      if (!assertCollectionAllowed(plugin, collection)) return reply.code(403).send({ error: "Collection is not declared by this plugin" });
      const records = await prisma.pluginRecord.findMany({ where: { pluginSlug: plugin.slug, collection }, orderBy: { createdAt: "desc" }, take: 100 });
      return { records };
    },
  );

  app.post<{ Params: { slug: string; collection: string } }>(
    "/admin/api/plugins/:slug/records/:collection",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const collection = collectionParamSchema.parse(request.params.collection);
      if (!assertCollectionAllowed(plugin, collection)) return reply.code(403).send({ error: "Collection is not declared by this plugin" });
      const parsed = recordSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });
      const record = await prisma.pluginRecord.create({
        data: { pluginSlug: plugin.slug, collection, data: parsed.data.data as Prisma.InputJsonValue },
      });
      return reply.code(201).send({ record });
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>(
    "/admin/api/plugins/:slug/records/by-id/:id",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });
      const record = await prisma.pluginRecord.findFirst({ where: { id: request.params.id, pluginSlug: plugin.slug } });
      if (!record) return reply.code(404).send({ error: "Plugin record not found" });
      await prisma.pluginRecord.delete({ where: { id: record.id } });
      return { success: true };
    },
  );
}
