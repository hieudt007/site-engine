import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { AgentFactory } from "../../agents/core/AgentFactory.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";

const HISTORY_LIMIT = 5;

const messageSchema = z.object({
  agentKey: z.string().min(1),
  message: z.string().min(1),
  imageUrl: z.string().url().optional().nullable(),
  entityId: z.string().optional().nullable(),
  themeSlug: z.string().optional().nullable(),
  landingPageSlug: z.string().optional().nullable(),
  pluginSlug: z.string().optional().nullable(),
  availableFields: z.array(z.string()).optional().nullable(),
  toolData: z.record(z.any()).optional().nullable(),
});

// Route THU NGHIEM cho nen mong MCP (AgentFactory/BaseAgent/ToolRegistry/MarkdownParser) - chay
// SONG SONG voi luong cu (aiChat.ts, khong dung/thay the), de kiem tra end-to-end truoc khi tinh
// chuyen router chat that sang day. Dung chung bang AdminChatHistory voi luong cu (phan biet qua
// entityId) de tai su dung lich su chat neu can.
export async function registerMcpChatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/api/mcp-chat/messages", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = messageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const userId = request.session.get("userId") as number;
    const { agentKey, message, imageUrl, entityId } = parsed.data;

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    const sseWrite = (data: any) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

    const agent = await AgentFactory.create(agentKey);
    if (!agent) {
      sseWrite({ step: "error", label: `Không tìm thấy Agent "${agentKey}".` });
      reply.raw.end();
      return reply;
    }

    const prevItems = await prisma.adminChatHistory.findMany({
      where: { userId, entityId: entityId || null },
      orderBy: { id: "desc" },
      take: HISTORY_LIMIT,
    });
    const history: ChatHistoryItem[] = [];
    for (const item of [...prevItems].reverse()) {
      history.push({ role: "user", content: item.userMessage });
      if (item.assistantResponse && item.status !== "error") {
        history.push({ role: "assistant", content: item.assistantResponse });
      }
    }

    const historyRow = await prisma.adminChatHistory.create({
      data: { userId, entityId: entityId || null, userMessage: message, imageUrl: imageUrl || null, status: "pending" },
    });

    try {
      const result = await agent.run(
        {
          meta: {
            themeSlug: parsed.data.themeSlug || undefined,
            landingPageSlug: parsed.data.landingPageSlug || undefined,
            pluginSlug: parsed.data.pluginSlug || undefined,
            availableFields: parsed.data.availableFields || undefined,
            toolData: parsed.data.toolData || undefined,
          },
          history,
          reply,
        },
        message,
        imageUrl || undefined,
      );

      const responseText =
        typeof result === "string" ? result : (result as Record<string, any>)?.message || JSON.stringify(result);

      await prisma.adminChatHistory.update({
        where: { id: historyRow.id },
        data: { assistantResponse: responseText, status: "success" },
      });

      sseWrite({ step: "done", payload: typeof result === "string" ? { action: "chat", message: result } : result });
    } catch (err: any) {
      await prisma.adminChatHistory.update({
        where: { id: historyRow.id },
        data: { status: "error", errorMessage: err.message },
      });
      sseWrite({ step: "error", label: "Lỗi AI: " + err.message });
    }

    reply.raw.end();
    return reply;
  });
}
