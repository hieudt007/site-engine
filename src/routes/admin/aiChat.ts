import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { callAgent, generateImage } from "../../services/aiClient.js";
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
        const agentPurpose = parsed.data.nextAgent === "content" ? "content" : "chat";
        const agent = await prisma.agent.findFirst({
          where: { isActive: true, purpose: agentPurpose },
        });

        if (!agent) {
          return reply.code(503).send({ message: `Không tìm thấy AI Agent cho mục đích ${agentPurpose}.` });
        }

        const systemPrompt = (agent.systemPrompt || `Bạn là một trợ lý AI chuyên về ${agentPurpose}.`) + 
          "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object with the following format:\n" +
          `{"action": "fill_form", "data": {"<field_id>": "<field_value>"}, "message": "Nội dung phản hồi cho user"}\n` +
          "Your response will be used to automatically fill the form on the frontend." +
          (parsed.data.availableFields && parsed.data.availableFields.length > 0 ? `\n\n- The available HTML element IDs on the current page are: [${parsed.data.availableFields.join(', ')}]. You MUST ONLY select IDs from this list to fill in the data object.\n- SPECIAL FIELD: if you are filling the "faq" field, its value MUST be an array of objects in this format: [{"question": "...", "answer": "..."}].\n- SPECIAL FIELD: if you are filling the "keyword" field, its value MUST be a comma-separated string (e.g. "key1, key2").` : "");
        
        const userPrompt = `Yêu cầu của người dùng: ${parsed.data.originalMessage || parsed.data.message}\n` +
          `Dữ liệu form hiện tại:\n${JSON.stringify(parsed.data.toolData, null, 2)}`;

        try {
          const responseText = await callAgent(agent, systemPrompt, userPrompt, parsed.data.imageUrl, true);
          let responseJson;
          try {
            responseJson = parseAiJson(responseText);
          } catch (e) {
            responseJson = { action: "chat", message: responseText };
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
        "\n\nCRITICAL INSTRUCTION: You MUST act as an orchestrator. If the user asks you to write, generate, or evaluate content/data that requires interacting with the current form, you MUST return a valid JSON object in this format:\n" +
        `{"action": "request_fields", "fields": ["<field_id_1>", "<field_id_2>"], "nextAgent": "content", "message": "Đang đọc dữ liệu form để phân tích..."}\n` +
        "Where 'fields' is an array of HTML element IDs on the current page that you need to read. ONLY request the specific fields that are absolutely necessary to fulfill the user's request.\n" +
        (parsed.data.availableFields && parsed.data.availableFields.length > 0 ? `- The available HTML element IDs on the current page are: [${parsed.data.availableFields.join(', ')}]. You MUST ONLY select IDs from this list. NOTE: if "faq" or "keyword" is in the list, you can request them.\n` : "") +
        "If the user asks you to generate, create, or draw an image, return JSON in this format:\n" +
        `{"action": "generate_image", "prompt": "Chi tiết mô tả ảnh bằng tiếng Anh", "message": "Đang tạo ảnh..."}\n` +
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
        const responseText = await callAgent(agent, systemPrompt, parsed.data.message, parsed.data.imageUrl, true);
        
        let responseJson;
        try {
          responseJson = parseAiJson(responseText);
        } catch (e) {
          responseJson = { action: "chat", message: responseText };
        }

        if (responseJson.action === "request_fields") {
          responseJson.historyId = historyRow.id;
          return responseJson;
        } else if (responseJson.action === "generate_image") {
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
}
