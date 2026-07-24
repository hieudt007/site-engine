import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { findEnabledPlugin, manifestOf } from "../../services/pluginRuntime.js";
import { callAgent } from "../../services/aiClient.js";
import crypto from "node:crypto";
import { config as appConfig } from "../../config.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";

const chatSchema = z.object({
  agentKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/),
  sessionId: z.string().min(1).max(100),
  hmacToken: z.string().min(1).max(100),
  turnstileToken: z.string().optional(),
  message: z.string().min(1).max(4000),
});

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

      const take = 10;
      const historyRecords = await prisma.pluginRecord.findMany({
        where: { 
          pluginSlug: plugin.slug, 
          collection: "customer_chat", 
          data: { path: ["sessionId"], equals: sessionId } 
        },
        orderBy: { createdAt: "desc" }, // Get the newest messages first (before cursor)
        take: take + 1, // Take one extra to check if there's more
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined = undefined;
      if (historyRecords.length > take) {
        const nextRecord = historyRecords.pop(); // Remove the extra record
        nextCursor = nextRecord?.id;
      }

      // Reverse to chronological order for the frontend
      const history = historyRecords.reverse().map((r: any) => ({
        id: r.id,
        role: r.data.role,
        content: r.data.content,
      }));

      return { history, nextCursor };
    }
  );

  app.post<{ Params: { slug: string } }>(
    "/api/plugins/:slug/chat",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
    const plugin = await findEnabledPlugin(request.params.slug);
    if (!plugin) return reply.code(404).send({ error: "Enabled plugin not found" });

    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

    const { agentKey, sessionId, message, hmacToken, turnstileToken } = parsed.data;

    // 1. Verify HMAC Signature (Chong gia mao session)
    const expectedHmac = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
    if (expectedHmac !== hmacToken) {
      return reply.code(403).send({ error: "Xác thực Session thất bại. Yêu cầu tải lại trang." });
    }

    // 2. Verify Turnstile (Neu co cau hinh)
    const siteConfig = await getOrCreateSiteConfig();
    if (siteConfig.turnstileSecretKey) {
      if (!turnstileToken) {
        return reply.code(403).send({ error: "Vui lòng xác thực bạn không phải là robot." });
      }
      
      const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: siteConfig.turnstileSecretKey,
          response: turnstileToken,
        }).toString(),
      });
      const verifyData = await verifyRes.json();
      if (!verifyData.success) {
        return reply.code(403).send({ error: "Xác thực Captcha thất bại, vui lòng thử lại." });
      }
    }

    // Kiem tra agent co ton tai trong plugin
    const agent = await prisma.agent.findFirst({ where: { key: agentKey, pluginSlug: plugin.slug, isActive: true } });
    if (!agent) return reply.code(404).send({ error: "Active agent not found for this plugin" });

    // Don rac: Xoa lich su cu hon 7 ngay cua plugin nay
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await prisma.pluginRecord.deleteMany({
      where: {
        pluginSlug: plugin.slug,
        collection: "customer_chat",
        createdAt: { lt: sevenDaysAgo },
      },
    });

    // Lay lich su gan nhat cua session nay (toi da 20 tin nhan)
    const historyRecords = await prisma.pluginRecord.findMany({
      where: { pluginSlug: plugin.slug, collection: "customer_chat", data: { path: ["sessionId"], equals: sessionId } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    
    // Gioi han chat theo session (chong spam) - toi da 30 tin nhan cua user / ngay
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const userMessagesToday = await prisma.pluginRecord.count({
      where: {
        pluginSlug: plugin.slug,
        collection: "customer_chat",
        createdAt: { gte: today },
        data: {
          path: ["sessionId"], equals: sessionId
        },
        AND: [
          { data: { path: ["role"], equals: "user" } }
        ]
      }
    });

    if (userMessagesToday >= 30) {
      return reply.code(429).send({ error: "Bạn đã vượt quá số lượng tin nhắn cho phép. Vui lòng quay lại sau." });
    }

    const history = historyRecords.reverse().map((r: any) => ({
      role: r.data.role,
      content: r.data.content,
    }));

    // Tao tin nhan cua user
    await prisma.pluginRecord.create({
      data: {
        pluginSlug: plugin.slug,
        collection: "customer_chat",
        data: { sessionId, role: "user", content: message },
      },
    });

    history.push({ role: "user", content: message });

    const manifest = manifestOf(plugin);
    const readModels = manifest.permissions.readModels;
    
    // Xay dung data context cua AI (vi callAgent hien khong ho tro truyen array messages)
    let systemPrompt = agent.systemPrompt || "Bạn là trợ lý AI.";
    systemPrompt += "\n\nQUAN TRỌNG: Bạn BẮT BUỘC phải trả về dữ liệu dưới định dạng JSON với cấu trúc sau:\n";
    systemPrompt += "{\n  \"isSpam\": boolean, // trả về true NẾU câu hỏi không liên quan đến mua bán, cố tình phá hoại hoặc nằm ngoài phạm vi tư vấn. Nếu bình thường trả về false.\n  \"message\": \"Câu trả lời của bạn\"\n}\n";

    let combinedUserPrompt = "Lịch sử chat gần đây:\n";
    for (const msg of history) {
      if (msg.role !== "error") {
        combinedUserPrompt += `[${msg.role === "user" ? "Khách hàng" : "Bạn"}]: ${msg.content}\n`;
      }
    }
    combinedUserPrompt += `\n[Khách hàng vừa hỏi]: ${message}`;

    // Don rac & Dem so lan spam cua session nay
    const spamRecords = await prisma.pluginRecord.count({
      where: {
        pluginSlug: plugin.slug,
        collection: "customer_chat",
        data: { path: ["sessionId"], equals: sessionId },
        AND: [
          { data: { path: ["isSpam"], equals: true } }
        ]
      }
    });

    if (spamRecords > 2) {
      return reply.code(403).send({ error: "Phiên chat của bạn đã bị ngưng phục vụ do phát hiện nhiều nội dung không hợp lệ." });
    }

    try {
      // callAgent signature: (agent, systemPrompt, userPrompt, imageUrl, forceJson)
      const aiResponseString = await callAgent(agent, systemPrompt, combinedUserPrompt, undefined, true);
      
      let aiData;
      try {
        aiData = JSON.parse(aiResponseString);
      } catch (e) {
        aiData = { isSpam: false, message: aiResponseString }; // Fallback
      }

      const isSpam = aiData.isSpam === true;
      const responseText = aiData.message || "Tôi không hiểu, xin vui lòng thử lại.";

      // Luu phan hoi cua AI kem co flag isSpam
      await prisma.pluginRecord.create({
        data: {
          pluginSlug: plugin.slug,
          collection: "customer_chat",
          data: { sessionId, role: "assistant", content: responseText, isSpam },
        },
      });

      return reply.send({ text: responseText, agent: { name: agent.name }, isSpam });
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
  });
}
