import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { findEnabledPlugin, manifestOf } from "../../services/pluginRuntime.js";
import { callAgentWithTools, AiMessage, AiTool } from "../../services/aiClient.js";
import crypto from "node:crypto";
import { config as appConfig } from "../../config.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";

const chatSchema = z.object({
  agentKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  sessionId: z.string().min(1).max(100),
  hmacToken: z.string().min(1).max(100),
  turnstileToken: z.string().optional(),
  message: z.string().min(1).max(4000),
  url: z.string().optional(),
  title: z.string().optional(),
  productId: z.string().optional(),
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

export async function registerPluginChatRoutes(app: FastifyInstance): Promise<void> {
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
      const historyRecords = await prisma.pluginRecord.findMany({
        where: { 
          pluginSlug: plugin.slug, 
          collection: "customer_chat", 
          data: { path: ["sessionId"], equals: sessionId } 
        },
        orderBy: { createdAt: "desc" },
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined = undefined;
      if (historyRecords.length > take) {
        const nextRecord = historyRecords.pop();
        nextCursor = nextRecord?.id;
      }

      const history = historyRecords.reverse().map((r: any) => {
        let content = r.data.content;
        let images = [];
        if (r.data.role === 'assistant') {
          try {
            const parsed = JSON.parse(content);
            if (parsed.messages) content = parsed.messages.join('\n\n');
            if (parsed.images) images = parsed.images;
          } catch(e) {}
        }
        return {
          id: r.id,
          role: r.data.role,
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

      const { agentKey, sessionId, message, hmacToken, turnstileToken, url, title, productId } = parsed.data;

      const expectedHmac = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
      if (expectedHmac !== hmacToken) {
        return reply.code(403).send({ error: "Xác thực Session thất bại. Yêu cầu tải lại trang." });
      }

      const siteConfig = await getOrCreateSiteConfig();
      if (siteConfig.turnstileSecretKey) {
        if (!turnstileToken) return reply.code(403).send({ error: "Vui lòng xác thực bạn không phải là robot." });
        const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret: siteConfig.turnstileSecretKey, response: turnstileToken }).toString(),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) return reply.code(403).send({ error: "Xác thực Captcha thất bại, vui lòng thử lại." });
      }

      const agent = await prisma.agent.findFirst({ where: { key: agentKey, pluginSlug: plugin.slug, isActive: true } });
      if (!agent) return reply.code(404).send({ error: "Active agent not found for this plugin" });

      // Don rac va chong spam
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      await prisma.pluginRecord.deleteMany({
        where: { pluginSlug: plugin.slug, collection: "customer_chat", createdAt: { lt: sevenDaysAgo } },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const userMessagesToday = await prisma.pluginRecord.count({
        where: {
          pluginSlug: plugin.slug,
          collection: "customer_chat",
          createdAt: { gte: today },
          data: { path: ["sessionId"], equals: sessionId },
          AND: [{ data: { path: ["role"], equals: "user" } }]
        }
      });
      if (userMessagesToday >= 30) {
        return reply.code(429).send({ error: "Bạn đã vượt quá số lượng tin nhắn cho phép. Vui lòng quay lại sau." });
      }

      const spamRecords = await prisma.pluginRecord.count({
        where: {
          pluginSlug: plugin.slug,
          collection: "customer_chat",
          data: { path: ["sessionId"], equals: sessionId },
          AND: [{ data: { path: ["isSpam"], equals: true } }]
        }
      });
      if (spamRecords > 2) {
        return reply.code(403).send({ error: "Phiên chat của bạn đã bị ngưng phục vụ do phát hiện nhiều nội dung không hợp lệ." });
      }

      const historyRecords = await prisma.pluginRecord.findMany({
        where: { pluginSlug: plugin.slug, collection: "customer_chat", data: { path: ["sessionId"], equals: sessionId } },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      const history = historyRecords.reverse().map((r: any) => {
        let content = r.data.content;
        if (r.data.role === 'assistant') {
          try {
            const parsed = JSON.parse(content);
            if (parsed.messages) content = parsed.messages.join('\n');
            if (parsed.images && parsed.images.length > 0) content += `\n[Đã đính kèm ảnh: ${parsed.images.join(', ')}]`;
          } catch(e) {}
        }
        return {
          role: r.data.role,
          content,
        };
      });

      await prisma.pluginRecord.create({
        data: {
          pluginSlug: plugin.slug,
          collection: "customer_chat",
          data: { sessionId, role: "user", content: message },
        },
      });

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
                     const products = await prisma.productCache.findMany({
                       where: { name: { contains: args.query, mode: 'insensitive' } },
                       take: 5
                     });
                     toolResult = JSON.stringify(products.map(p => ({ id: p.id, name: p.name, price: p.price, salePrice: p.salePrice, imageUrl: p.imageUrls?.[0] })));
                  }
                  else if (call.function.name === "get_product") {
                     const product = await prisma.productCache.findUnique({
                       where: { id: args.productId }
                     });
                     toolResult = product ? JSON.stringify({ name: product.name, price: product.price, salePrice: product.salePrice, inStock: product.stock, imageUrls: product.imageUrls }) : "Not found";
                  }
                  else if (call.function.name === "check_order") {
                     const orders = await prisma.cartOrder.findMany({
                       where: { OR: [{ customerPhone: args.phoneOrCode }, { shortCode: args.phoneOrCode }] },
                       orderBy: { createdAt: 'desc' }, take: 3
                     });
                     toolResult = JSON.stringify(orders.map(o => ({ code: o.shortCode, status: o.status, date: o.createdAt })));
                  }
                  else if (call.function.name === "create_lead") {
                     await prisma.pluginRecord.create({
                       data: {
                         pluginSlug: plugin.slug,
                         collection: "leads",
                         data: { name: args.name, phone: args.phone, notes: args.notes, source: "ai_chat", sessionId, url }
                       }
                     });
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

        await prisma.pluginRecord.create({
          data: {
            pluginSlug: plugin.slug,
            collection: "customer_chat",
            data: { sessionId, role: "assistant", content: JSON.stringify(parsedData), isSpam },
          },
        });

        return reply.send({ 
          messages: parsedData.messages || (parsedData.message ? [parsedData.message] : []),
          images: parsedData.images || [],
          agent: { name: agent.name }, 
          isSpam 
        });
      } catch (err: any) {
        await prisma.pluginRecord.create({
          data: {
            pluginSlug: plugin.slug,
            collection: "customer_chat",
            data: { sessionId, role: "error", content: err.message },
          },
        });
        return reply.code(502).send({ error: "AI Error: " + err.message });
      }
    }
  );
}
