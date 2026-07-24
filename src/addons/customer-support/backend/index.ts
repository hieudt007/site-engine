import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { getPluginDb } from "../../../services/pluginDb.js";
const pluginDb = getPluginDb("customer-support");
import { findEnabledPlugin, manifestOf } from "../../../services/pluginRuntime.js";
import { callAgentWithTools, AiMessage, AiTool } from "../../../services/aiClient.js";
import crypto from "node:crypto";
import { config as appConfig } from "../../../config.js";
import { getOrCreateSiteConfig } from "../../../services/siteConfig.js";

import { requireRole } from "../../../plugins/requireRole.js";
import { renderAdmin } from "../../../services/adminView.js";
import { saveAiChatImage } from "../../../services/mediaStorage.js";

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

const tools: AiTool[] = [
  {
    type: "function",
    function: {
      name: "search_product",
      description: "Tìm kiếm sản phẩm trên website theo tên hoặc từ khoá",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_product",
      description: "Xem chi tiết một sản phẩm (giá, ảnh, tồn kho, mô tả)",
      parameters: {
        type: "object",
        properties: { productId: { type: "string" } },
        required: ["productId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "check_order",
      description: "Kiểm tra trạng thái đơn hàng bằng số điện thoại hoặc mã đơn",
      parameters: {
        type: "object",
        properties: { phoneOrCode: { type: "string" } },
        required: ["phoneOrCode"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_lead",
      description: "Lưu thông tin khách hàng tiềm năng khi họ để lại SĐT hoặc muốn tư vấn/đặt hàng",
      parameters: {
        type: "object",
        properties: { 
          name: { type: "string", description: "Tên khách hàng (nếu có)" },
          phone: { type: "string", description: "Số điện thoại của khách" },
          notes: { type: "string", description: "Ghi chú, nhu cầu của khách" }
        },
        required: ["phone"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mark_as_spam",
      description: "Đánh dấu tin nhắn hiện tại là spam, phá hoại hoặc không liên quan đến mua bán.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"]
      }
    }
  }
];

export async function register(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string }; Querystring: { sessionId: string; hmacToken: string; cursor?: string } }>(
    "/api/plugins/:slug/chat",
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });

      const { sessionId, hmacToken, cursor } = request.query;
      if (!sessionId || !hmacToken) return reply.code(400).send({ error: "Missing tokens" });

      const expectedHmac = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
      if (expectedHmac !== hmacToken) {
        return reply.code(403).send({ error: "Xác thực Session thất bại." });
      }

      const take = 5;
      const historyRecords = await pluginDb.$queryRaw<any[]>`
        SELECT * FROM "PluginCustomerSupportChat"
        WHERE "sessionId" = ${sessionId}
        ${cursor ? Prisma.sql`AND "id" < ${parseInt(cursor as string)}` : Prisma.empty}
        ORDER BY "id" DESC
        LIMIT ${take + 1}
      `;

      let nextCursor: string | undefined = undefined;
      if (historyRecords.length > take) {
        const nextRecord = historyRecords.pop();
        nextCursor = nextRecord?.id;
      }

      const history = historyRecords.reverse().map((r: any) => {
        let content = r.message;
        let images = r.images || [];
        if (r.role === 'assistant') {
          try {
            const parsed = JSON.parse(content);
            if (parsed.messages) content = parsed.messages.join('\n\n');
            if (parsed.images) images = parsed.images;
          } catch(e) {}
        }
        return {
          id: r.id,
          role: r.role,
          content,
          images
        };
      });

      return { history, nextCursor };
    }
  );

  app.post<{ Params: { slug: string } }>(
    "/api/plugins/:slug/chat",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });

      const parsed = chatSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

      const { agentKey, sessionId, message, hmacToken, turnstileToken, url, title, productId, images } = parsed.data;

      const expectedHmac = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
      if (expectedHmac !== hmacToken) {
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

      const agent = await pluginDb.agent.findFirst({ where: { key: agentKey, pluginSlug: plugin.slug, isActive: true } });
      if (!agent) return reply.code(404).send({ error: "Active agent not found for this plugin" });

      // Don rac va chong spam
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      await pluginDb.$executeRaw`DELETE FROM "PluginCustomerSupportChat" WHERE "createdAt" < ${sevenDaysAgo}`;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [{ count: userMessagesTodayStr }] = await pluginDb.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM "PluginCustomerSupportChat"
        WHERE "createdAt" >= ${today} AND "sessionId" = ${sessionId} AND "role" = 'user'
      `;
      const userMessagesToday = Number(userMessagesTodayStr);
      if (userMessagesToday >= 30) {
        return reply.code(429).send({ error: "Bạn đã vượt quá số lượng tin nhắn cho phép. Vui lòng quay lại sau." });
      }

      const [{ count: spamRecordsStr }] = await pluginDb.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM "PluginCustomerSupportChat"
        WHERE "sessionId" = ${sessionId} AND "role" = 'error'
      `;
      const spamRecords = Number(spamRecordsStr);
      if (spamRecords > 2) {
        return reply.code(403).send({ error: "Phiên chat của bạn đã bị ngưng phục vụ do phát hiện nhiều nội dung không hợp lệ." });
      }

      const historyRecords = await pluginDb.$queryRaw<any[]>`
        SELECT * FROM "PluginCustomerSupportChat"
        WHERE "sessionId" = ${sessionId}
        ORDER BY "id" DESC
        LIMIT 5
      `;

      const history = historyRecords.reverse().map((r: any) => {
        let content = r.message;
        if (r.role === 'assistant') {
          try {
            const parsed = JSON.parse(content);
            if (parsed.messages) content = parsed.messages.join('\n');
            if (parsed.images && parsed.images.length > 0) content += `\n[Đã đính kèm ảnh: ${parsed.images.join(', ')}]`;
          } catch(e) {}
        }
        return {
          role: r.role,
          content,
        };
      });

      await pluginDb.$executeRaw`
        INSERT INTO "PluginCustomerSupportChat" ("sessionId", "agentKey", "role", "message", "images", "url", "title", "productId")
        VALUES (${sessionId}, ${agentKey}, 'user', ${message}, ${images ? JSON.stringify(images) : '[]'}::jsonb, ${url || null}, ${title || null}, ${productId || null})
      `;

      let systemPrompt = agent.systemPrompt || "Bạn là trợ lý AI.";
      systemPrompt += `\n\n--- NGỮ CẢNH TRANG HIỆN TẠI ---\nURL: ${url || 'Không có'}\nTiêu đề: ${title || 'Không có'}\n`;
      if (productId) {
        systemPrompt += `\nKhách đang xem sản phẩm có ID: ${productId}. BẠN CÓ THỂ GỌI TOOL get_product ĐỂ LẤY CHI TIẾT SẢN PHẨM NÀY NẾU CẦN.`;
      }
      systemPrompt += `\n\nQUAN TRỌNG: Câu trả lời cuối cùng của bạn cho khách hàng BẮT BUỘC phải là 1 chuỗi JSON hợp lệ có cấu trúc sau:
{
  "messages": ["Đoạn chat 1", "Đoạn chat 2..."],
  "images": ["url_anh_1", "url_anh_2..."] // Mảng các URL hình ảnh sản phẩm nếu có
}
Lưu ý: TRẢ VỀ ĐÚNG JSON, KHÔNG KÈM THEO MARKDOWN HAY BẤT KỲ VĂN BẢN NÀO KHÁC BÊN NGOÀI JSON.`;
      
      const aiMessages: AiMessage[] = [
        { role: "system", content: systemPrompt }
      ];
      
      for (const msg of history) {
        if (msg.role !== "error" && msg.role !== "system") {
          aiMessages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.content });
        }
      }
      aiMessages.push({ role: "user", content: message });

      let loopCount = 0;
      let finalResponse = "";
      let isSpam = false;

      try {
        while (loopCount < 5) {
          loopCount++;
          const res = await callAgentWithTools(agent, aiMessages, tools);
          
          if (res.type === "text") {
             finalResponse = res.text || "";
             break;
          }
          
          if (res.type === "tool_calls" && res.tool_calls) {
             aiMessages.push(res.rawMessage);
             
             for (const call of res.tool_calls) {
                const args = JSON.parse(call.function.arguments || "{}");
                let toolResult = "";
                
                try {
                  if (call.function.name === "search_product") {
                     const products = await pluginDb.productCache.findMany({
                       where: { name: { contains: args.query, mode: 'insensitive' } },
                       take: 5
                     });
                     toolResult = JSON.stringify(products.map(p => ({ id: p.id, name: p.name, price: p.price, salePrice: p.salePrice, imageUrl: p.imageUrls?.[0] })));
                  }
                  else if (call.function.name === "get_product") {
                     const product = await pluginDb.productCache.findUnique({
                       where: { id: args.productId }
                     });
                     toolResult = product ? JSON.stringify({ name: product.name, price: product.price, salePrice: product.salePrice, inStock: product.stock, imageUrls: product.imageUrls }) : "Not found";
                  }
                  else if (call.function.name === "check_order") {
                     const orders = await pluginDb.cartOrder.findMany({
                       where: { OR: [{ customerPhone: args.phoneOrCode }, { id: args.phoneOrCode }] },
                       orderBy: { createdAt: 'desc' }, take: 3
                     });
                     toolResult = JSON.stringify(orders.map(o => ({ code: o.id, status: o.status, date: o.createdAt })));
                  }
                  else if (call.function.name === "create_lead") {
                     await pluginDb.$executeRaw`
                       INSERT INTO "PluginCustomerSupportLead" ("name", "phone", "notes", "sessionId", "url")
                       VALUES (${args.name || null}, ${args.phone}, ${args.notes || null}, ${sessionId || null}, ${url || null})
                     `;
                     toolResult = "Đã lưu thông tin khách hàng thành công. Hãy báo cho khách biết.";
                  }
                  else if (call.function.name === "mark_as_spam") {
                     isSpam = true;
                     toolResult = "Đã đánh dấu spam. Hãy trả lời ngắn gọn từ chối phục vụ.";
                  }
                  else {
                     toolResult = "Tool not found.";
                  }
                } catch (toolErr: any) {
                  toolResult = "Lỗi khi chạy tool: " + toolErr.message;
                }
                
                aiMessages.push({
                   role: "tool",
                   content: toolResult,
                   tool_call_id: call.id
                });
             }
          }
        }
        
        if (!finalResponse) {
          finalResponse = JSON.stringify({ messages: ["Tôi đã xử lý yêu cầu nhưng không thể kết luận. Xin thử lại."], images: [] });
        }

        let parsedData: any = {};
        try {
          // Remove markdown json block if AI wraps it
          let cleanJson = finalResponse.replace(/^```json/m, '').replace(/```$/m, '').trim();
          parsedData = JSON.parse(cleanJson);
        } catch (e) {
          parsedData = { messages: [finalResponse], images: [] };
        }

        await pluginDb.$executeRaw`
          INSERT INTO "PluginCustomerSupportChat" ("sessionId", "agentKey", "role", "message")
          VALUES (${sessionId}, ${agentKey}, 'assistant', ${JSON.stringify(parsedData)})
        `;

        return reply.send({ 
          messages: parsedData.messages || (parsedData.message ? [parsedData.message] : []),
          images: parsedData.images || [],
          agent: { name: agent.name }, 
          isSpam 
        });
      } catch (err: any) {
        await pluginDb.$executeRaw`
          INSERT INTO "PluginCustomerSupportChat" ("sessionId", "agentKey", "role", "message")
          VALUES (${sessionId}, ${agentKey}, 'error', ${err.message})
        `;
        return reply.code(502).send({ error: "AI Error: " + err.message });
      }
    }
  );
  app.post<{ Params: { slug: string } }>(
    "/api/plugins/:slug/chat/upload",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request, reply) => {
      const plugin = await findEnabledPlugin(request.params.slug);
      if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });

      if (!request.isMultipart()) return reply.code(400).send({ error: "Request is not multipart" });
      
      const parts = request.parts();
      let sessionId = "";
      let hmacToken = "";
      let uploadedFile: { url: string; filename: string } | null = null;
      let partBuffer: Buffer | null = null;
      let partMime = "";

      for await (const part of parts) {
        if (part.type === 'file') {
          partBuffer = await part.toBuffer();
          partMime = part.mimetype;
        } else if (part.type === 'field') {
          if (part.fieldname === 'sessionId') sessionId = part.value as string;
          if (part.fieldname === 'hmacToken') hmacToken = part.value as string;
        }
      }

      if (!sessionId || !hmacToken) return reply.code(400).send({ error: "Missing session tokens" });

      const expectedHmac = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
      if (expectedHmac !== hmacToken) {
        return reply.code(403).send({ error: "Xác thực Session thất bại." });
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

  await registerLiveChatRoutes(app);
}

const sendSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});

async function registerLiveChatRoutes(app: FastifyInstance): Promise<void> {
  // API lay danh sach Sessions
  app.get<{ Params: { slug: string } }>(
    "/admin/api/plugins/:slug/live-chat/sessions",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const pluginSlug = request.params.slug;

      const recentMessages = await pluginDb.$queryRaw<any[]>`
        SELECT * FROM "PluginCustomerSupportChat"
        ORDER BY "id" DESC
        LIMIT 200
      `;

      const sessionsMap = new Map();
      for (const msg of recentMessages) {
        if (!msg.sessionId) continue;
        
        if (!sessionsMap.has(msg.sessionId)) {
          sessionsMap.set(msg.sessionId, {
            sessionId: msg.sessionId,
            lastMessage: msg.message,
            lastRole: msg.role,
            updatedAt: msg.createdAt,
          });
        }
      }

      const sessions = Array.from(sessionsMap.values());
      return { sessions };
    }
  );

  // API lay tin nhan cua 1 session
  app.get<{ Params: { slug: string }; Querystring: { sessionId: string } }>(
    "/admin/api/plugins/:slug/live-chat/history",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const pluginSlug = request.params.slug;
      const { sessionId } = request.query;

      const records = await pluginDb.$queryRaw<any[]>`
        SELECT * FROM "PluginCustomerSupportChat"
        WHERE "sessionId" = ${sessionId as string}
        ORDER BY "id" ASC
        LIMIT 100
      `;

      const history = records.map(r => ({
        id: r.id,
        role: r.role,
        content: r.message,
        createdAt: r.createdAt
      }));

      return { history };
    }
  );

  // API Admin gui tin nhan
  app.post<{ Params: { slug: string } }>(
    "/admin/api/plugins/:slug/live-chat/send",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const pluginSlug = request.params.slug;
      const parsed = sendSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

      const { sessionId, message } = parsed.data;

      const record = await pluginDb.pluginRecord.create({
        data: {
          pluginSlug,
          collection: "customer_chat",
          data: { sessionId, role: "admin", content: message },
        }
      });

      return { success: true, record };
    }
  );
}

