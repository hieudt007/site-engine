import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../../db.js";
import { config as appConfig } from "../../config.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";
import { BaseAgent, AgentContext } from "../../agents/core/BaseAgent.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";
import { saveAiChatImage } from "../../services/mediaStorage.js";
import { decryptNodeString } from "../../nodeCrypt.js";

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

// Chan timing attack: "===" so sanh chuoi dung short-circuit tai ky tu dau tien khac nhau, lo ra
// khac biet thoi gian ti le voi so ky tu dau khop dung - ke tan cong co the do do de doan dan
// tung ky tu cua hmacToken hop le cho 1 sessionId bat ky. Dung cung pattern voi vnpay.ts trong
// repo nay (crypto.timingSafeEqual, kem check do dai truoc vi ham nay throw neu 2 buffer khac size).
export function verifyHmac(sessionId: string, hmacToken: string): boolean {
  const expected = crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(hmacToken);
  return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export async function registerCustomerChatPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sessionId: string; hmacToken: string; cursor?: string } }>(
    "/api/customer-chat",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
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
          body: new URLSearchParams({ secret: decryptNodeString(siteConfig.turnstileSecretKey), response: turnstileToken }).toString(),
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

      // Dem chung 2 loai "vi pham": "error" (AI xu ly bi exception that su) VA "spam" (AI TU nhan
      // dien qua tool mark_as_spam - xem duoi). Truoc day chi dem "error", con "spam" chi tra ve
      // FE qua field isSpam ma KHONG luu DB/khong dem gi ca - tool mark_as_spam vi vay chua he co
      // tac dung khoa session that su, chi la 1 loi khuyen suong cho AI tu choi lich su. Gio gop
      // chung 1 nguong de tool nay co hieu luc thuc te.
      const abuseRecords = await prisma.customerChatMessage.count({ where: { sessionId, role: { in: ["error", "spam"] } } });
      if (abuseRecords > 2) {
        return reply.code(403).send({ error: "Phiên chat của bạn đã bị ngưng phục vụ do phát hiện nhiều nội dung không hợp lệ." });
      }

      const historyRecords = await prisma.customerChatMessage.findMany({
        where: { sessionId },
        orderBy: { id: "desc" },
        take: 5,
      });

      // Tach tool-call/tool-result thanh TURN RIENG (giong het hinh dang "messages" that su dung
      // TRONG luc chay 1 luot cua BaseAgent.runLoop(), va giong cach aiChat.ts build lai lich su
      // admin) - KHONG gop thanh 1 cau van ban mo ta nhet truoc cau tra loi cuoi. Khach vang lai
      // (khong dang nhap) nen KHONG dung get_memory/save_memory o day - agent "customer" cung
      // khong duoc gan 2 tool do trong allowedTools (xem seedAgents.ts).
      const history: ChatHistoryItem[] = [];
      for (const r of [...historyRecords].reverse()) {
        if (r.role !== "user" && r.role !== "assistant") continue;
        if (r.role === "user") {
          history.push({ role: "user", content: r.message });
          continue;
        }
        if (r.metadata) {
          try {
            const meta = JSON.parse(r.metadata);
            const actions = Array.isArray(meta.actions) ? meta.actions : [];
            // Gom theo "round" (BaseAgent.ts: trace.push({..., round: loopCount})) - nhieu tool
            // CUNG round nghia la AI goi chung 1 luot (1 turn assistant chua nhieu phan tu
            // tool_calls), dung dung hinh dang that su da xay ra luc chay. Du lieu cu (truoc khi co
            // "round") khong co field nay - fallback ve index rieng (moi tool 1 round) de van hoat
            // dong duoc, chi khong gom nhom chinh xac cho log cu.
            const rounds = new Map<number, typeof actions>();
            actions.forEach((a: any, i: number) => {
              const key = a.round ?? i;
              if (!rounds.has(key)) rounds.set(key, []);
              rounds.get(key)!.push(a);
            });
            for (const group of rounds.values()) {
              // Dung hinh dang native tool-calling THAT (id THAT tu provider, luu lai trong
              // metadata.actions luc live - xem BaseAgent.ts trace.push()) - khong con tu chep JSON
              // trong content nua.
              history.push({
                role: "assistant",
                content: null,
                toolCalls: group.map((a: any) => ({ id: a.id, name: a.tool, args: a.args || {} })),
              });
              group.forEach((a: any) => {
                history.push({ role: "tool", toolCallId: a.id, content: a.result });
              });
            }
          } catch {}
        }
        let content = r.message;
        try {
          const parsed = JSON.parse(content);
          if (parsed.messages) content = parsed.messages.join("\n");
        } catch {}
        history.push({ role: "assistant", content });
      }

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

      // AI provider tu tai anh ve tu URL nay, can TUYET DOI (khong phai /uploads/... tuong doi tu
      // client) - xem ghi chu trong aiClient.ts. Chi gui anh DAU TIEN (BaseAgent.run() hien chi nhan
      // 1 imageUrl, giong luong admin aiChat.ts).
      const imageUrl = images && images.length > 0
        ? (/^https?:\/\//.test(images[0]) ? images[0] : `${request.protocol}://${request.hostname}${images[0]}`)
        : undefined;

      // Chuyen sang SSE TU DAY (moi validate/loi phia tren van la JSON response binh thuong, giu
      // nguyen cho frontend cu) - de context.reply co the dung, cho phep BaseAgent.streamMessageDelta
      // ban tung doan "message" real-time (hieu ung go chu that, giong luong admin aiChat.ts) khi
      // agent CSKH nay bat settings.stream=true (Agent.settings). Neu stream=false thi hanh vi y het truoc day, chi
      // khac o cho ket qua tra ve qua 1 event "done" thay vi thang trong body response.
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      const sseWrite = (data: Record<string, unknown>) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

      // hostname: can cho tool create_order (agentTools/customerSupportTools.ts) khi goi
      // sendOrderToLeadbase() - LeadBase can biet Website nao gui don de tra dung secret xac thuc.
      const context: AgentContext = { meta: { sessionId, url, productId, hostname: request.hostname }, history, reply };

      try {
        const result = await new BaseAgent(agent).run(context, finalMessage, imageUrl);
        const resultObj: any = typeof result === "string" ? { messages: [result] } : result;
        // Khong con field "images" rieng - URL anh nam thang trong noi dung message, frontend
        // (chat-drawer.js) tu nhan dien va tach ra hien rieng (xem RESPONSE_FORMAT_GUIDE).
        const messagesOut: string[] = resultObj.messages || (resultObj.message ? [resultObj.message] : []);
        const isSpam = !!context.meta.isSpam;

        // resultObj.actions (BaseAgent.runLoop()) = qua trinh goi tool + ket qua cua LUOT NAY - luu
        // vao metadata de get_chat_history doc lai duoc o cac luot sau (xem xay dung "history" o tren).
        const metadata = Array.isArray(resultObj.actions) && resultObj.actions.length > 0
          ? JSON.stringify({ actions: resultObj.actions })
          : undefined;

        await prisma.customerChatMessage.create({
          data: {
            sessionId,
            agentKey,
            role: "assistant",
            message: JSON.stringify({ messages: messagesOut }),
            ...(metadata ? { metadata } : {}),
          },
        });

        // Ghi rieng 1 ban ghi role="spam" khi AI goi mark_as_spam - CHI de dem cho nguong
        // abuseRecords o tren (khong anh huong lich su hoi thoai hien thi lai cho AI, vi
        // formatHistoryBlock/vong lap build "history" phia tren chi doc role "user"/"assistant").
        // Tin nhan tu choi cua AI (messagesOut) van duoc luu binh thuong o tren nhu 1 luot assistant,
        // ban ghi nay chi la "the bao pham loi" rieng.
        if (isSpam) {
          await prisma.customerChatMessage.create({
            data: { sessionId, agentKey, role: "spam", message: messagesOut.join("\n") || "(AI flagged this message as spam)" },
          });
        }

        sseWrite({ step: "done", payload: { messages: messagesOut, agent: { name: agent.name }, isSpam } });
      } catch (err: any) {
        await prisma.customerChatMessage.create({
          data: { sessionId, agentKey, role: "error", message: err.message },
        });
        sseWrite({ step: "error", label: "AI Error: " + err.message });
      }

      reply.raw.end();
      return reply;
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
