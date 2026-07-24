import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPluginDb } from "../../../services/pluginDb.js";
import { requireRole } from "../../../plugins/requireRole.js";
import { callAgent, generateImage, webFetch, webSearch } from "../../../services/aiClient.js";
import { InvalidUploadError, saveAiChatImage } from "../../../services/mediaStorage.js";
import fs from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";

const TABLE = "PluginAdminAiChatHistory";
const prisma = getPluginDb("admin-ai-chat");

// ─── Raw SQL helpers ──────────────────────────────────────────────────────────

async function dbFindHistory(userId: number, entityId: string | null, beforeId?: number | null) {
  if (beforeId) {
    return prisma.$queryRaw<any[]>`
      SELECT * FROM "PluginAdminAiChatHistory"
      WHERE "userId" = ${userId} AND "entityId" IS NOT DISTINCT FROM ${entityId}
        AND "id" < ${beforeId}
      ORDER BY "id" DESC LIMIT 16
    `;
  }
  return prisma.$queryRaw<any[]>`
    SELECT * FROM "PluginAdminAiChatHistory"
    WHERE "userId" = ${userId} AND "entityId" IS NOT DISTINCT FROM ${entityId}
    ORDER BY "id" DESC LIMIT 16
  `;
}

async function dbFindContext(userId: number, entityId: string | null) {
  return prisma.$queryRaw<any[]>`
    SELECT * FROM "PluginAdminAiChatHistory"
    WHERE "userId" = ${userId} AND "entityId" IS NOT DISTINCT FROM ${entityId}
      AND "status" = 'success'
    ORDER BY "id" DESC LIMIT 5
  `;
}

async function dbCreate(data: {
  userId: number;
  entityId?: string | null;
  userMessage: string;
  imageUrl?: string | null;
  assistantResponse?: string | null;
  status: string;
}) {
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO "PluginAdminAiChatHistory"
      ("userId", "entityId", "userMessage", "imageUrl", "assistantResponse", "status")
    VALUES
      (${data.userId}, ${data.entityId ?? null}, ${data.userMessage}, ${data.imageUrl ?? null}, ${data.assistantResponse ?? null}, ${data.status})
    RETURNING "id"
  `;
  return rows[0];
}

async function dbUpdate(id: number, data: { assistantResponse?: string | null; status?: string; errorMessage?: string | null }) {
  await prisma.$executeRaw`
    UPDATE "PluginAdminAiChatHistory"
    SET
      "assistantResponse" = COALESCE(${data.assistantResponse ?? null}, "assistantResponse"),
      "status"            = COALESCE(${data.status ?? null}, "status"),
      "errorMessage"      = COALESCE(${data.errorMessage ?? null}, "errorMessage")
    WHERE "id" = ${id}
  `;
}

// ─── Cleanup cron (daily midnight) ────────────────────────────────────────────

function startCleanupCron() {
  const AI_CHAT_DIR = path.join(process.cwd(), "uploads", "ai-chat");
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  cron.schedule("0 0 * * *", async () => {
    try {
      const exists = await fs.access(AI_CHAT_DIR).then(() => true).catch(() => false);
      if (!exists) return;
      const files = await fs.readdir(AI_CHAT_DIR);
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(AI_CHAT_DIR, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > MAX_AGE_MS) {
          await fs.unlink(filePath).catch(console.error);
        }
      }
    } catch (err) {
      console.error("Admin AI Chat Cleanup Error:", err);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const querySchema = z.object({
  before_id: z.coerce.number().optional().nullable(),
  entityId: z.string().optional().nullable(),
});

const messageSchema = z.object({
  message: z.string().min(1),
  imageUrl: z.string().url().optional().nullable(),
  pageTitle: z.string().optional().nullable(),
  pageUrl: z.string().optional().nullable(),
  availableFields: z.array(z.string()).optional().nullable(),
  isToolResponse: z.boolean().optional().nullable(),
  toolData: z.record(z.any()).optional().nullable(),
  originalMessage: z.string().optional().nullable(),
  nextAgent: z.string().optional().nullable(),
  layoutMode: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  historyId: z.number().optional().nullable(),
});

function parseAiJson(text: string) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) return JSON.parse(match[1]);
  return JSON.parse(text);
}

// ─── Register ────────────────────────────────────────────────────────────────

export async function register(app: FastifyInstance): Promise<void> {
  // Start cleanup cron
  if (process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === "0") {
    startCleanupCron();
  }

  // GET /admin/api/ai-chat/history
  app.get(
    "/admin/api/ai-chat/history",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ message: "Invalid query" });

      const userId = request.session.get("userId") as number;
      const entityId = parsed.data.entityId || null;
      const beforeId = parsed.data.before_id;

      const items = await dbFindHistory(userId, entityId, beforeId);
      const hasMore = items.length > 15;
      const results = items.slice(0, 15);

      return {
        items: results.map((msg: any) => ({
          id: msg.id,
          user_message: msg.userMessage,
          image_url: msg.imageUrl,
          assistant_response: msg.assistantResponse,
          status: msg.status,
          error_message: msg.errorMessage,
          created_at: msg.createdAt,
        })),
        has_more: hasMore,
        next_before_id: hasMore ? results[results.length - 1].id : null,
      };
    }
  );

  // POST /admin/api/ai-chat/messages
  app.post(
    "/admin/api/ai-chat/messages",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "Message is required." });

      const userId = request.session.get("userId") as number;

      // Luồng 2: Frontend đã gửi dữ liệu form
      if (parsed.data.isToolResponse) {
        let agentKey = parsed.data.nextAgent === "content" ? "content" : "chat";
        if (parsed.data.nextAgent === "developer") agentKey = "developer";
        if (parsed.data.nextAgent === "content_then_developer") agentKey = "content";

        const agent = await prisma.agent.findFirst({ where: { isActive: true, key: agentKey } });
        if (!agent) return reply.code(503).send({ message: `Không tìm thấy AI Agent cho mục đích ${agentKey}.` });

        let systemPrompt = agent.systemPrompt || `Bạn là một trợ lý AI chuyên về ${agentKey}.`;
        if (agentKey === "content") {
          systemPrompt += "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object with the following format:\n" +
            `{"action": "fill_form", "data": {"<field_id>": "<field_value>"}, "message": "Nội dung phản hồi cho user"}\n` +
            "Your response will be used to automatically fill the form on the frontend." +
            (parsed.data.nextAgent === "content_then_developer" ? `\n\n- SPECIAL RULE FOR HTML CONTENT: Because the user wants to generate a custom/landing layout, DO NOT write HTML code in the "body" or "description" field. Instead, write a detailed "Layout Blueprint" (text instructions on structure, sections, colors) in that field. A Developer Agent will read this blueprint and generate the actual HTML later.` : "") +
            (parsed.data.availableFields && parsed.data.availableFields.length > 0 ? `\n\n- The available HTML element IDs on the current page are: [${parsed.data.availableFields.join(', ')}]. You MUST ONLY select IDs from this list to fill in the data object.\n- SPECIAL FIELD: if you are filling the "faq" field, its value MUST be an array of objects in this format: [{"question": "...", "answer": "..."}].\n- SPECIAL FIELD: if you are filling the "keyword" field, its value MUST be a comma-separated string (e.g. "key1, key2").` : "") +
            (parsed.data.toolData && parsed.data.toolData.searchResults ? `\n\n- INTERNAL LINKS: You have been provided with search results for related articles/products in the form data (searchResults). Use these URLs to insert anchor tags (e.g., <a href="/url">Title</a>) into the content where appropriate.` : "");
        } else if (agentKey === "developer") {
          systemPrompt += "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object with the following format:\n" +
            `{"action": "fill_form", "data": {"body": "<raw_html_code>"}, "message": "Đã code xong giao diện"}\n` +
            "You MUST output raw HTML/Tailwind in the data.body field (or data.description if body is not available). DO NOT use markdown code blocks for the JSON output itself unless parsed properly, but ensure the string inside JSON is properly escaped.";
        } else {
          systemPrompt += "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object with the following format:\n" +
            `{"action": "chat", "message": "Nội dung câu trả lời của bạn"}\n`;
        }

        const userPrompt = `Yêu cầu của người dùng: ${parsed.data.originalMessage || parsed.data.message}\n` +
          `Dữ liệu công cụ/form cung cấp:\n${JSON.stringify(parsed.data.toolData, null, 2)}`;

        try {
          const responseText = await callAgent(agent, systemPrompt, userPrompt, parsed.data.imageUrl || undefined, true);
          let responseJson: any;
          try { responseJson = parseAiJson(responseText); } catch { responseJson = { action: "chat", message: responseText }; }

          // Chuỗi agent: content_then_developer
          if (parsed.data.nextAgent === "content_then_developer" && responseJson.data) {
            const blueprint = responseJson.data.body || responseJson.data.description || "";
            if (blueprint) {
              const devAgent = await prisma.agent.findFirst({ where: { isActive: true, key: "developer" } });
              if (devAgent) {
                const devSystemPrompt = (devAgent.systemPrompt || "Bạn là một Frontend Developer.") +
                  "\n\nCRITICAL INSTRUCTION: Return a valid JSON object:\n" +
                  `{"action": "fill_form", "data": {"body": "<raw_html_code>"}}\n`;
                const devUserPrompt = `Yêu cầu của người dùng: ${parsed.data.originalMessage || parsed.data.message}\n\nHãy viết mã HTML/TailwindCSS nguyên gốc (Raw HTML) dựa trên Blueprint/Cấu trúc sau:\n${blueprint}`;
                const devResponseText = await callAgent(devAgent, devSystemPrompt, devUserPrompt, undefined, true);
                try {
                  const devJson = parseAiJson(devResponseText);
                  if (devJson.data?.body) {
                    if (responseJson.data.body !== undefined) responseJson.data.body = devJson.data.body;
                    else if (responseJson.data.description !== undefined) responseJson.data.description = devJson.data.body;
                  }
                } catch { /* ignore */ }
              }
            }
          }

          if (parsed.data.historyId) {
            await dbUpdate(parsed.data.historyId, { assistantResponse: responseJson.message || "Đã xử lý xong", status: "success" });
          } else {
            await dbCreate({ userId, entityId: parsed.data.entityId || null, userMessage: parsed.data.originalMessage || parsed.data.message, imageUrl: parsed.data.imageUrl, assistantResponse: responseJson.message || "Đã xử lý xong", status: "success" });
          }
          return responseJson;
        } catch (error: any) {
          if (parsed.data.historyId) {
            await dbUpdate(parsed.data.historyId, { status: "error", errorMessage: error.message });
          }
          return reply.code(500).send({ message: "Lỗi kết nối AI: " + error.message });
        }
      }

      // Luồng 1: Yêu cầu chat ban đầu
      const isContentEditPage = !!parsed.data.pageUrl?.match(/\/admin\/(posts|pages|products)\//);
      const agentKey = isContentEditPage ? "content" : "chat";
      const agent = await prisma.agent.findFirst({ where: { isActive: true, key: agentKey } });
      if (!agent) return reply.code(503).send({ message: `Không tìm thấy AI Agent cho mục đích ${agentKey}.` });

      const contextItems = await dbFindContext(userId, parsed.data.entityId || null);
      let contextStr = "";
      if (contextItems.length > 0) {
        contextStr = "\n\n--- Lịch sử trò chuyện gần nhất ---\n";
        for (const item of [...contextItems].reverse()) {
          contextStr += `User: ${item.userMessage} ${item.imageUrl ? `[Đính kèm ảnh: ${item.imageUrl}]` : ''}\nAssistant: ${item.assistantResponse}\n`;
        }
      }

      const [fetchAgent, searchAgent, imageAgent] = await Promise.all([
        prisma.agent.findFirst({ where: { isActive: true, key: "fetch" } }),
        prisma.agent.findFirst({ where: { isActive: true, key: "search" } }),
        prisma.agent.findFirst({ where: { isActive: true, key: "image" } }),
      ]);

      const systemPrompt = (agent.systemPrompt || "Bạn là một trợ lý AI hỗ trợ quản trị viên của hệ thống Site Engine.") +
        (parsed.data.pageTitle ? `\n\n[Context] User hiện đang ở trang: "${parsed.data.pageTitle}" (URL: ${parsed.data.pageUrl || 'Không rõ'})` : "") +
        (parsed.data.layoutMode ? `\n[Context] Giao diện (layoutMode) đang chọn: "${parsed.data.layoutMode}". (Lưu ý: 'custom' hoặc 'landing' nghĩa là nội dung body/description chứa mã HTML nguyên gốc).` : "") +
        "\n\nCRITICAL INSTRUCTION: You MUST act as an orchestrator. If the user asks you to write, generate, or evaluate content/data that requires interacting with the current form, you MUST return a valid JSON object in this format:\n" +
        `{"action": "request_fields", "fields": ["<field_id_1>", "<field_id_2>"], "search_query": "từ khóa (optional)", "nextAgent": "content", "message": "Đang đọc dữ liệu form để phân tích..."}\n` +
        "Where 'fields' is an array of HTML element IDs on the current page that you need to read. ONLY request the specific fields that are absolutely necessary to fulfill the user's request.\n" +
        "- If the user asks to **tạo mới (create new)** a landing page or custom interface from scratch, you MUST set `nextAgent` to `\"content_then_developer\"`.\n" +
        "- If the user asks to **chỉnh sửa (edit)** the current design/HTML directly, you MUST set `nextAgent` to `\"developer\"`.\n" +
        "If you need to find related posts or products to add internal links to the content, you CAN include 'search_query' with a keyword.\n" +
        (parsed.data.availableFields && parsed.data.availableFields.length > 0 ? `- The available HTML element IDs on the current page are: [${parsed.data.availableFields.join(', ')}]. You MUST ONLY select IDs from this list. NOTE: if "faq" or "keyword" is in the list, you can request them.\n` : "") +
        (imageAgent ? "If the user asks you to generate, create, or draw an image, return JSON in this format:\n" +
        `{"action": "generate_image", "prompt": "Chi tiết mô tả ảnh bằng tiếng Anh", "message": "Đang tạo ảnh..."}\n` : "") +
        (fetchAgent ? "If you need to fetch content from a URL to answer the user's question, return JSON in this format:\n" +
        `{"action": "webfetch", "url": "URL cần lấy nội dung", "message": "Đang đọc nội dung trang web..."}\n` : "") +
        (searchAgent ? "If you need to search the web for information to answer the user's question, return JSON in this format:\n" +
        `{"action": "websearch", "query": "Từ khóa tìm kiếm", "message": "Đang tìm kiếm trên mạng..."}\n` : "") +
        "If the user just asks a general question, answer normally by returning JSON in this format:\n" +
        `{"action": "chat", "message": "Câu trả lời của bạn"}\n` +
        contextStr;

      const historyRow = await dbCreate({ userId, entityId: parsed.data.entityId || null, userMessage: parsed.data.message, imageUrl: parsed.data.imageUrl, status: "pending" });

      try {
        const responseText = await callAgent(agent, systemPrompt, parsed.data.message, parsed.data.imageUrl || undefined, true);
        let responseJson: any;
        try { responseJson = parseAiJson(responseText); } catch { responseJson = { action: "chat", message: responseText }; }

        if (responseJson.action === "request_fields") {
          if (responseJson.search_query) {
            const q = responseJson.search_query;
            const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
            const postPre = (config?.postSlugPrefix && config.postSlugPrefix !== "/") ? config.postSlugPrefix : "p";
            const productPre = (config?.productSlugPrefix && config.productSlugPrefix !== "/") ? config.productSlugPrefix : "product";
            const [posts, products] = await Promise.all([
              prisma.post.findMany({ where: { type: "post", title: { contains: q, mode: "insensitive" } }, select: { title: true, slug: true }, take: 5 }),
              prisma.productCache.findMany({ where: { name: { contains: q, mode: "insensitive" } }, select: { name: true, slug: true }, take: 5 }),
            ]);
            responseJson.searchResults = [
              ...posts.map((p: any) => ({ title: p.title, url: `/${postPre}/${p.slug}` })),
              ...products.map((p: any) => ({ title: p.name, url: `/${productPre}/${p.slug}` })),
            ];
          }
          responseJson.historyId = historyRow.id;
          return responseJson;
        } else if (responseJson.action === "generate_image" || responseJson.action === "webfetch" || responseJson.action === "websearch") {
          responseJson.historyId = historyRow.id;
          return responseJson;
        } else {
          await dbUpdate(historyRow.id, { assistantResponse: responseJson.message || responseText, status: "success" });
          return responseJson;
        }
      } catch (error: any) {
        await dbUpdate(historyRow.id, { status: "error", errorMessage: error.message });
        return reply.code(500).send({ message: "Lỗi kết nối AI: " + error.message });
      }
    }
  );

  // POST /admin/api/ai-chat/generate-image
  app.post(
    "/admin/api/ai-chat/generate-image",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({
        prompt: z.string().min(1),
        size: z.string().optional(),
        agentId: z.string().optional(),
        key: z.string().optional().default("image"),
        historyId: z.number().optional(),
      });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "Invalid parameters" });

      let agent;
      if (parsed.data.agentId) {
        agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
      } else {
        agent = await prisma.agent.findFirst({ where: { isActive: true, key: parsed.data.key } });
      }
      if (!agent) return reply.code(404).send({ message: "Không tìm thấy AI Agent phù hợp" });

      try {
        const imageUrl = await generateImage(agent, parsed.data.prompt, parsed.data.size || "1024x1024");
        if (parsed.data.historyId) {
          const markdownImg = `![Tạo ảnh](${imageUrl})\n\n[Link ảnh](${imageUrl})`;
          await dbUpdate(parsed.data.historyId, { assistantResponse: markdownImg, status: "success" });
        }
        return reply.send({ url: imageUrl });
      } catch (error: any) {
        if (parsed.data.historyId) await dbUpdate(parsed.data.historyId, { status: "error", errorMessage: error.message });
        return reply.code(500).send({ message: error.message || "Lỗi khi sinh ảnh" });
      }
    }
  );

  // POST /admin/api/ai-chat/webfetch
  app.post(
    "/admin/api/ai-chat/webfetch",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({ url: z.string().url(), key: z.string().optional().default("fetch") });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "Invalid parameters" });
      const agent = await prisma.agent.findFirst({ where: { isActive: true, key: parsed.data.key } });
      if (!agent) return reply.code(404).send({ message: `Không tìm thấy AI Agent với key ${parsed.data.key}` });
      try {
        const result = await webFetch(agent, parsed.data.url);
        return reply.send({ result });
      } catch (error: any) {
        return reply.code(500).send({ message: error.message || "Lỗi khi gọi Web Fetch API" });
      }
    }
  );

  // POST /admin/api/ai-chat/websearch
  app.post(
    "/admin/api/ai-chat/websearch",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({ query: z.string().min(1), key: z.string().optional().default("search") });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "Invalid parameters" });
      const agent = await prisma.agent.findFirst({ where: { isActive: true, key: parsed.data.key } });
      if (!agent) return reply.code(404).send({ message: `Không tìm thấy AI Agent với key ${parsed.data.key}` });
      try {
        const result = await webSearch(agent, parsed.data.query);
        return reply.send({ result });
      } catch (error: any) {
        return reply.code(500).send({ message: error.message || "Lỗi khi gọi Web Search API" });
      }
    }
  );

  // POST /admin/api/ai-chat/upload
  app.post(
    "/admin/api/ai-chat/upload",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.isMultipart()) return reply.code(400).send({ error: "Request is not multipart" });

      const parts = request.parts();
      let uploadedFile: { url: string; filename: string } | null = null;
      let partBuffer: Buffer | null = null;
      let partMime = "";

      for await (const part of parts) {
        if (part.type === "file") {
          partBuffer = await part.toBuffer();
          partMime = part.mimetype;
        }
      }
      if (!partBuffer) return reply.code(400).send({ error: "No file uploaded" });

      try {
        uploadedFile = await saveAiChatImage(partBuffer, partMime);
      } catch (e: any) {
        return reply.code(400).send({ error: e.message || "Lỗi upload file" });
      }
      return { url: uploadedFile.url };
    }
  );
}
