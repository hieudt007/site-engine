import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { callAgent, generateImage, webFetch, webSearch } from "../../services/aiClient.js";
import { InvalidUploadError, saveAiChatImage } from "../../services/mediaStorage.js";

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
  if (match) {
    return JSON.parse(match[1]);
  }
  return JSON.parse(text);
}

export async function registerAiChatRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/api/ai-chat/history",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid query" });
      }

      const beforeId = parsed.data.before_id;
      const userId = request.session.get("userId") as number;

      // In LeadBase it returns 15 items per page
      const entityId = parsed.data.entityId || null;
      const items = await prisma.adminChatHistory.findMany({
        where: {
          userId,
          entityId,
          ...(beforeId ? { id: { lt: beforeId } } : {}),
        },
        orderBy: { id: "desc" },
        take: 16, // take one more to check has_more
      });

      const hasMore = items.length > 15;
      const results = items.slice(0, 15);
      
      // Reverse to return ascending order for UI if we want?
      // LeadBase AiChatWidget expects the items in some order, but it prepends older messages.
      // Actually, LeadBase's `toChatMessages` function just maps them and we might need to sort them by id asc.
      // Wait, LeadBase returns history ordered by `id desc` from backend! 
      // Then in React, it uses `[...toChatMessages(response.data.items), ...current]`. 
      // This means the API returns items in `desc` order, but then they are reversed? 
      // No, `toChatMessages` just maps them. If backend returns newest first, then `[...newest, ...current]` would put newest at top, which is WRONG!
      // In LeadBase, `orderByDesc('id')` is used, but then it's `reverse()`? Let's assume LeadBase API returns ascending order for the chunk, or the component handles it. 
      // Let's just return descending like LeadBase's `latest()` usually does, or just return ascending for the chunk.
      // To be safe, we return descending like a normal paginated API and let the UI handle it. Wait! The UI I'm writing will handle it.

      return {
        items: results.map((msg) => ({
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

  app.post(
    "/admin/api/ai-chat/messages",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Message is required." });
      }

      const userId = request.session.get("userId") as number;

      // Luồng 2: Frontend đã gửi dữ liệu form
      if (parsed.data.isToolResponse) {
        let agentKey = parsed.data.nextAgent === "content" ? "content" : "chat";
        if (parsed.data.nextAgent === "developer") agentKey = "developer";
        if (parsed.data.nextAgent === "content_then_developer") agentKey = "content"; // Call content first
        
        const agent = await prisma.agent.findFirst({
          where: { isActive: true, key: agentKey },
        });

        if (!agent) {
          return reply.code(503).send({ message: `Không tìm thấy AI Agent cho mục đích ${agentKey}.` });
        }

        let systemPrompt = (agent.systemPrompt || `Bạn là một trợ lý AI chuyên về ${agentKey}.`);
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
        
        let userPrompt = `Yêu cầu của người dùng: ${parsed.data.originalMessage || parsed.data.message}\n` +
          `Dữ liệu công cụ/form cung cấp:\n${JSON.stringify(parsed.data.toolData, null, 2)}`;

        try {
          const responseText = await callAgent(agent, systemPrompt, userPrompt, parsed.data.imageUrl || undefined, true);
          let responseJson;
          try {
            responseJson = parseAiJson(responseText);
          } catch (e) {
            responseJson = { action: "chat", message: responseText };
          }

          // CHUỖI AGENT: Nếu là content_then_developer, tiếp tục gọi developer agent
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
                  if (devJson.data && devJson.data.body) {
                    if (responseJson.data.body !== undefined) responseJson.data.body = devJson.data.body;
                    else if (responseJson.data.description !== undefined) responseJson.data.description = devJson.data.body;
                  }
                } catch (e) {
                  // Ignore parse error, use original blueprint
                }
              }
            }
          }

          if (parsed.data.historyId) {
            await prisma.adminChatHistory.update({
              where: { id: parsed.data.historyId },
              data: {
                assistantResponse: responseJson.message || "Đã xử lý xong",
                status: "success",
              },
            });
          } else {
            await prisma.adminChatHistory.create({
              data: {
                userId,
                entityId: parsed.data.entityId || null,
                userMessage: parsed.data.originalMessage || parsed.data.message,
                imageUrl: parsed.data.imageUrl,
                assistantResponse: responseJson.message || "Đã xử lý xong",
                status: "success",
              },
            });
          }

          return responseJson;
        } catch (error: any) {
          if (parsed.data.historyId) {
            await prisma.adminChatHistory.update({
              where: { id: parsed.data.historyId },
              data: { status: "error", errorMessage: error.message }
            });
          }
          return reply.code(500).send({ message: "Lỗi kết nối AI: " + error.message });
        }
      }

      // Luồng 1: Yêu cầu chat ban đầu
      const isContentEditPage = !!parsed.data.pageUrl?.match(/\/admin\/(posts|pages|products)\//);
      const agentKey = isContentEditPage ? "content" : "chat";
      
      const agent = await prisma.agent.findFirst({
        where: { isActive: true, key: agentKey },
      });

      if (!agent) {
        return reply.code(503).send({ message: `Không tìm thấy AI Agent cho mục đích ${agentKey}.` });
      }

      const contextItems = await prisma.adminChatHistory.findMany({
        where: { userId, entityId: parsed.data.entityId || null, status: "success" },
        orderBy: { id: "desc" },
        take: 5,
      });
      
      let contextStr = "";
      if (contextItems.length > 0) {
        contextStr = "\n\n--- Lịch sử trò chuyện gần nhất ---\n";
        for (const item of [...contextItems].reverse()) {
          contextStr += `User: ${item.userMessage} ${item.imageUrl ? `[Đính kèm ảnh: ${item.imageUrl}]` : ''}\nAssistant: ${item.assistantResponse}\n`;
        }
      }

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
        "If the user asks you to generate, create, or draw an image, return JSON in this format:\n" +
        `{"action": "generate_image", "prompt": "Chi tiết mô tả ảnh bằng tiếng Anh", "message": "Đang tạo ảnh..."}\n` +
        "If you need to fetch content from a URL to answer the user's question, return JSON in this format:\n" +
        `{"action": "webfetch", "url": "URL cần lấy nội dung", "message": "Đang đọc nội dung trang web..."}\n` +
        "If you need to search the web for information to answer the user's question, return JSON in this format:\n" +
        `{"action": "websearch", "query": "Từ khóa tìm kiếm", "message": "Đang tìm kiếm trên mạng..."}\n` +
        "If the user just asks a general question, answer normally by returning JSON in this format:\n" +
        `{"action": "chat", "message": "Câu trả lời của bạn"}\n` +
        contextStr;

      const historyRow = await prisma.adminChatHistory.create({
        data: {
          userId,
          entityId: parsed.data.entityId || null,
          userMessage: parsed.data.message,
          imageUrl: parsed.data.imageUrl,
          status: "pending",
        },
      });

      try {
        const responseText = await callAgent(agent, systemPrompt, parsed.data.message, parsed.data.imageUrl || undefined, true);
        
        let responseJson;
        try {
          responseJson = parseAiJson(responseText);
        } catch (e) {
          responseJson = { action: "chat", message: responseText };
        }

        if (responseJson.action === "request_fields") {
          if (responseJson.search_query) {
            const q = responseJson.search_query;
            const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
            const postPre = (config?.postSlugPrefix && config.postSlugPrefix !== "/") ? config.postSlugPrefix : "p";
            const productPre = (config?.productSlugPrefix && config.productSlugPrefix !== "/") ? config.productSlugPrefix : "product";
            
            const [posts, products] = await Promise.all([
              prisma.post.findMany({
                where: { type: "post", title: { contains: q, mode: "insensitive" } },
                select: { title: true, slug: true },
                take: 5,
              }),
              prisma.productCache.findMany({
                where: { name: { contains: q, mode: "insensitive" } },
                select: { name: true, slug: true },
                take: 5,
              })
            ]);
            
            responseJson.searchResults = [
              ...posts.map(p => ({ title: p.title, url: `/${postPre}/${p.slug}` })),
              ...products.map(p => ({ title: p.name, url: `/${productPre}/${p.slug}` }))
            ];
          }
          responseJson.historyId = historyRow.id;
          return responseJson;
        } else if (responseJson.action === "generate_image" || responseJson.action === "webfetch" || responseJson.action === "websearch") {
          responseJson.historyId = historyRow.id;
          return responseJson;
        } else {
          await prisma.adminChatHistory.update({
            where: { id: historyRow.id },
            data: {
              assistantResponse: responseJson.message || responseText,
              status: "success",
            },
          });
          return responseJson;
        }
      } catch (error: any) {
        await prisma.adminChatHistory.update({
          where: { id: historyRow.id },
          data: { status: "error", errorMessage: error.message }
        });
        return reply.code(500).send({ message: "Lỗi kết nối AI: " + error.message });
      }
    }
  );

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
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid parameters" });
      }

      let agent;
      if (parsed.data.agentId) {
        agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
      } else {
        agent = await prisma.agent.findFirst({
          where: { isActive: true, key: parsed.data.key },
        });
      }

      if (!agent) {
        return reply.code(404).send({ message: `Không tìm thấy AI Agent phù hợp` });
      }

      try {
        const imageUrl = await generateImage(agent, parsed.data.prompt, parsed.data.size || "1024x1024");
        
        if (parsed.data.historyId) {
          const markdownImg = `![Tạo ảnh](${imageUrl})\n\n[Link ảnh](${imageUrl})`;
          await prisma.adminChatHistory.update({
            where: { id: parsed.data.historyId },
            data: {
              assistantResponse: markdownImg,
              status: "success",
            }
          });
        }
        
        return reply.send({ url: imageUrl });
      } catch (error: any) {
        if (parsed.data.historyId) {
          await prisma.adminChatHistory.update({
            where: { id: parsed.data.historyId },
            data: {
              status: "error",
              errorMessage: error.message
            }
          });
        }
        return reply.code(500).send({ message: error.message || "Lỗi khi sinh ảnh" });
      }
    }
  );

  app.post(
    "/admin/api/ai-chat/webfetch",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({
        url: z.string().url(),
        key: z.string().optional().default("fetch"),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid parameters" });
      }

      const agent = await prisma.agent.findFirst({
        where: { isActive: true, key: parsed.data.key },
      });

      if (!agent) {
        return reply.code(404).send({ message: `Không tìm thấy AI Agent với key ${parsed.data.key}` });
      }

      try {
        const result = await webFetch(agent, parsed.data.url);
        return reply.send({ result });
      } catch (error: any) {
        return reply.code(500).send({ message: error.message || "Lỗi khi gọi Web Fetch API" });
      }
    }
  );

  app.post(
    "/admin/api/ai-chat/websearch",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({
        query: z.string().min(1),
        key: z.string().optional().default("search"),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid parameters" });
      }

      const agent = await prisma.agent.findFirst({
        where: { isActive: true, key: parsed.data.key },
      });

      if (!agent) {
        return reply.code(404).send({ message: `Không tìm thấy AI Agent với key ${parsed.data.key}` });
      }

      try {
        const result = await webSearch(agent, parsed.data.query);
        return reply.send({ result });
      } catch (error: any) {
        return reply.code(500).send({ message: error.message || "Lỗi khi gọi Web Search API" });
      }
    }
  );
}
