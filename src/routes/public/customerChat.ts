import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { config as appConfig } from "../../config.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";
import { BaseAgent, AgentContext } from "../../agents/core/BaseAgent.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";
import { saveAiChatImage } from "../../services/mediaStorage.js";

// Live-chat AI CSKH (agent key="customer") - truoc day la plugin "customer-support", gio la core
// feature (khong con chay code khong sandbox cua "plugin" nua, xem quyet dinh go bo plugin system).
// Chay qua BaseAgent/ToolRegistry/MarkdownParser (luong MCP dung chung voi routes/admin/aiChat.ts,
// routes/admin/mcpChat.ts) - khong con tu viet loop function-calling rieng nua.

const chatSchema = z.object({
  agentKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  sessionId: z.string().min(1).max(100),
  hmacToken: z.string().min(1).max(100),
  turnstileToken: z.string().optional(),
  message: z.string().min(1).max(4000),
  url: z.string().optional(),
  title: z.string().optional(),
  productId: z.string().optional(),
  images: z.array(z.string()).optional(),
});

function verifyHmac(sessionId: string, hmacToken: string): boolean {
  const expected = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
  return expected === hmacToken;
}

export async function registerCustomerChatPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sessionId: string; hmacToken: string; cursor?: string } }>(
    "/api/customer-chat",
    async (request, reply) => {
      const { sessionId, hmacToken, cursor } = request.query;
      if (!sessionId || !hmacToken) return reply.code(400).send({ error: "Missing tokens" });
      if (!verifyHmac(sessionId, hmacToken)) return reply.code(403).send({ error: "Xác thực Session thất bại." });

      const take = 5;
      const historyRecords = await prisma.customerChatMessage.findMany({
        where: { sessionId, ...(cursor ? { id: { lt: parseInt(cursor, 10) } } : {}) },
        orderBy: { id: "desc" },
        take: take + 1,
      });

      let nextCursor: string | undefined = undefined;
      if (historyRecords.length > take) {
        const nextRecord = historyRecords.pop();
        nextCursor = String(nextRecord?.id);
      }

      const history = historyRecords.reverse().map((r) => {
        let content: any = r.message;
        let images = (r.images as string[] | null) || [];
        if (r.role === "assistant") {
          try {
            const parsed = JSON.parse(content);
            if (parsed.messages) content = parsed.messages.join("\n\n");
            if (parsed.images) images = parsed.images;
          } catch {}
        }
        return { id: r.id, role: r.role, content, images };
      });

      return { history, nextCursor };
    },
  );

  app.post(
    "/api/customer-chat",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = chatSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

      const { sessionId, message, hmacToken, turnstileToken, url, title, productId, images } = parsed.data;

      if (!verifyHmac(sessionId, hmacToken)) {
        return reply.code(403).send({ error: "Xác thực Session thất bại. Yêu cầu tải lại trang." });
      }

      const siteConfig = await getOrCreateSiteConfig(request.hostname);
      if (siteConfig.turnstileSecretKey) {
        if (!turnstileToken) return reply.code(403).send({ error: "Vui lòng xác thực bạn không phải là robot." });
        const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: siteConfig.turnstileSecretKey, response: turnstileToken }).toString(),
        });
        const verifyData = (await verifyRes.json()) as any;
        if (!verifyData.success) return reply.code(403).send({ error: "Xác thực Captcha thất bại, vui lòng thử lại." });
      }

      if (!siteConfig.cskhAgentId) return reply.code(404).send({ error: "Chưa chọn Agent phụ trách CSKH trong Cài đặt chung." });
      const agent = await prisma.agent.findFirst({ where: { id: siteConfig.cskhAgentId, isActive: true } });
      if (!agent) return reply.code(404).send({ error: "Active agent not found" });
      const agentKey = agent.key || agent.id;

      // Don rac va chong spam
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      await prisma.customerChatMessage.deleteMany({ where: { createdAt: { lt: sevenDaysAgo } } });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const userMessagesToday = await prisma.customerChatMessage.count({
        where: { createdAt: { gte: today }, sessionId, role: "user" },
      });
      if (userMessagesToday >= 30) {
        return reply.code(429).send({ error: "Bạn đã vượt quá số lượng tin nhắn cho phép. Vui lòng quay lại sau." });
      }

      const spamRecords = await prisma.customerChatMessage.count({ where: { sessionId, role: "error" } });
      if (spamRecords > 2) {
        return reply.code(403).send({ error: "Phiên chat của bạn đã bị ngưng phục vụ do phát hiện nhiều nội dung không hợp lệ." });
      }

      const historyRecords = await prisma.customerChatMessage.findMany({
        where: { sessionId },
        orderBy: { id: "desc" },
        take: 5,
      });

      const history: ChatHistoryItem[] = historyRecords
        .filter((r) => r.role === "user" || r.role === "assistant")
        .reverse()
        .map((r) => {
          let content = r.message;
          if (r.role === "assistant") {
            try {
              const parsed = JSON.parse(content);
              if (parsed.messages) content = parsed.messages.join("\n");
            } catch {}
          }
          return { role: r.role as "user" | "assistant", content };
        });

      await prisma.customerChatMessage.create({
        data: {
          sessionId,
          agentKey,
          role: "user",
          message,
          images: images && images.length > 0 ? images : undefined,
          url: url || null,
          title: title || null,
          productId: productId || null,
        },
      });

      let finalMessage = message;
      finalMessage += `\n\n--- NGỮ CẢNH TRANG HIỆN TẠI ---\nURL: ${url || "Không có"}\nTiêu đề: ${title || "Không có"}`;
      if (productId) {
        finalMessage += `\nKhách đang xem sản phẩm có ID: ${productId}. Gọi tool get_product nếu cần chi tiết.`;
      }

      const context: AgentContext = { meta: { sessionId, url, productId }, history };

      try {
        const result = await new BaseAgent(agent).run(context, finalMessage);
        const resultObj: any = typeof result === "string" ? { messages: [result], images: [] } : result;
        const messagesOut: string[] = resultObj.messages || (resultObj.message ? [resultObj.message] : []);
        const imagesOut: string[] = resultObj.images || [];
        const isSpam = !!context.meta.isSpam;

        await prisma.customerChatMessage.create({
          data: { sessionId, agentKey, role: "assistant", message: JSON.stringify({ messages: messagesOut, images: imagesOut }) },
        });

        return reply.send({ messages: messagesOut, images: imagesOut, agent: { name: agent.name }, isSpam });
      } catch (err: any) {
        await prisma.customerChatMessage.create({
          data: { sessionId, agentKey, role: "error", message: err.message },
        });
        return reply.code(502).send({ error: "AI Error: " + err.message });
      }
    },
  );

  app.post(
    "/api/customer-chat/upload",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.isMultipart()) return reply.code(400).send({ error: "Request is not multipart" });

      const parts = request.parts();
      let sessionId = "";
      let hmacToken = "";
      let partBuffer: Buffer | null = null;
      let partMime = "";

      for await (const part of parts) {
        if (part.type === "file") {
          partBuffer = await part.toBuffer();
          partMime = part.mimetype;
        } else if (part.type === "field") {
          if (part.fieldname === "sessionId") sessionId = part.value as string;
          if (part.fieldname === "hmacToken") hmacToken = part.value as string;
        }
      }

      if (!sessionId || !hmacToken) return reply.code(400).send({ error: "Missing session tokens" });
      if (!verifyHmac(sessionId, hmacToken)) return reply.code(403).send({ error: "Xác thực Session thất bại." });
      if (!partBuffer) return reply.code(400).send({ error: "No file uploaded" });

      try {
        const uploadedFile = await saveAiChatImage(partBuffer, partMime);
        return { url: uploadedFile.url };
      } catch (e: any) {
        return reply.code(400).send({ error: e.message || "Lỗi upload file" });
      }
    },
  );
}
