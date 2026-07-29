import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { generateImage, webFetch, webSearch } from "../../agents/core/aiClient.js";
import { BaseAgent, AgentContext } from "../../agents/core/BaseAgent.js";
import { isRunActive, injectMessage } from "../../agents/core/runRegistry.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";
import { saveAiChatImage } from "../../services/mediaStorage.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";

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
  layoutMode: z.string().optional().nullable(),
  entityId: z.string().optional().nullable(),
  historyId: z.number().optional().nullable(),
});

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

  // Chay qua BaseAgent/ToolRegistry/MarkdownParser (luong MCP dung chung voi routes/public/
  // customerChat.ts, routes/admin/mcpChat.ts). Agent dieu phoi lay tu SiteConfig.adminChatAgentId
  // (Cai dat chung > AI & Tu dong hoa) - agent do tu quyet dinh AGENT_CALL sang developer/
  // content_writer/uiux_consultant hay tu tra loi, khong con danh sach sub-agent hardcode o day.
  app.post(
    "/admin/api/ai-chat/messages",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = messageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Message is required." });
      }

      const userId = request.session.get("userId") as number;

      const sseWrite = (data: any) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");

      const siteConfig = await getOrCreateSiteConfig(request.hostname);
      const chatAgent = siteConfig.adminChatAgentId
        ? await prisma.agent.findFirst({ where: { isActive: true, id: siteConfig.adminChatAgentId } })
        : null;
      if (!chatAgent) {
        sseWrite({ step: "error", label: "Chưa chọn Agent phụ trách Admin Chat trong Cài đặt chung." });
        reply.raw.end();
        return reply;
      }

      const entityId = parsed.data.entityId || null;
      const originalMessage = parsed.data.originalMessage || parsed.data.message;

      const contextItems = await prisma.adminChatHistory.findMany({
        where: { userId, entityId },
        orderBy: { id: "desc" },
        take: 5,
      });
      // Bo QUA CA CAP (user+assistant) neu la luot "pending" cua chinh request nay, hoac luot da loi
      // ("error"/khong co assistantResponse) - KHONG dua luot loi vao history de AI doc lai, tranh
      // dung bug da gap: AI "bat chuoc" lai cau tra loi hong/ky quac tu chinh no o lich su.
      const prevItems = contextItems.filter(
        (i) => !(i.userMessage === originalMessage && i.status === "pending") && i.status === "success" && i.assistantResponse
      );
      const history: ChatHistoryItem[] = [];
      for (const item of [...prevItems].reverse()) {
        history.push({ role: "user", content: item.userMessage });
        // metadata.actions (BaseAgent.runLoop() ghi lai khi tra loi - xem doan "done" o duoi) = cac
        // tool da goi + ket qua o luot do - tach thanh TUNG TURN RIENG (assistant tool-call + user
        // tool-result), giong het hinh dang "messages" that su dung TRONG luc chay 1 luot (xem
        // assistantEcho/trace.push o runLoop()) - KHONG con gop thanh 1 cau van ban "[Đã gọi tool X,
        // kết quả: Y]" nhet truoc cau tra loi cuoi (kieu cu lam AI kho phan biet dau la hanh dong,
        // dau la cau tra loi that).
        if (item.metadata) {
          try {
            const meta = JSON.parse(item.metadata);
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
              // trong content nua. Log cu (truoc khi co "id") se khong co field nay - bo qua an
              // toan (undefined), khong crash, chi khong tai tao dung 100% cho log rat cu.
              history.push({
                role: "assistant",
                content: null,
                toolCalls: group.map((a: any) => ({ id: a.id, name: a.tool, args: a.args || {} })),
              });
              group.forEach((a: any) => {
                history.push({ role: "tool", toolCallId: a.id, content: a.result });
              });
            }
          } catch { }
        }
        // assistantResponse luu trong DB la TEXT THUONG (khong con boc JSON gi ca - native
        // tool-calling, "content" cua assistant von di la text thuong, khong phai 1 field trong
        // JSON tu che nua).
        history.push({ role: "assistant", content: item.assistantResponse as string });
      }

      const historyRow = parsed.data.historyId
        ? await prisma.adminChatHistory.findUnique({ where: { id: parsed.data.historyId } })
        : await prisma.adminChatHistory.create({
            data: { userId, entityId, userMessage: originalMessage, imageUrl: parsed.data.imageUrl, status: "pending" },
          });
      if (!historyRow) {
        sseWrite({ step: "error", label: "Không tìm thấy lịch sử chat để tiếp tục." });
        reply.raw.end();
        return reply;
      }

      // Bao historyId cho frontend SOM (truoc khi run() co the chay lau) - de frontend biet ID nao
      // dang chay dang do, dung khi user go tiep tin nhan "chen ngang" trong luc AI dang xu ly.
      sseWrite({ step: "history_id", historyId: historyRow.id });

      // Chen ngang (steering): historyId nay dang co 1 run() KHAC con dang chay that (con trong
      // vong lap BaseAgent.run(), chua tra ve REPLY) - KHONG tao run() moi song song (dam context),
      // chi bom tin nhan vao hang doi de run() dang chay tu nhat len o lan goi AI tiep theo. Khac
      // voi luong "isToolResponse" resume binh thuong (run() cu DA tra ve/ket thuc khi do, nen
      // isRunActive se la false, khong bi chan o day).
      if (parsed.data.historyId && isRunActive(historyRow.id)) {
        injectMessage(historyRow.id, originalMessage);
        sseWrite({ step: "injected", label: "Đã gửi, AI sẽ xử lý ở bước tiếp theo." });
        reply.raw.end();
        return reply;
      }

      let finalMessage = originalMessage;
      if (parsed.data.layoutMode) finalMessage += `\n[Layout mode] ${parsed.data.layoutMode}`;

      // "[Trang hiện tại]"/FIELDS LIST - CALLER (o day) tu ghep thanh chuoi, BaseAgent khong con
      // biet gi ve trang/field cua tung luong (xem thao luan thiet ke AgentContext.extraSystemPrompt).
      const extraSystemPromptParts = [
        parsed.data.pageTitle ? `[Trang hiện tại] ${parsed.data.pageTitle} (${parsed.data.pageUrl || ""})` : undefined,
        (chatAgent.allowedTools || []).includes("read_fields") && parsed.data.availableFields && parsed.data.availableFields.length > 0
          ? `--- FIELDS LIST ---\n[${parsed.data.availableFields.join(", ")}]\n(Call read_fields to read a field's value)`
          : undefined,
      ].filter((p): p is string => !!p);

      const context: AgentContext = {
        meta: {
          pageUrl: parsed.data.pageUrl || undefined,
          pageTitle: parsed.data.pageTitle || undefined,
          availableFields: parsed.data.availableFields || undefined,
          toolData: parsed.data.isToolResponse ? parsed.data.toolData || undefined : undefined,
          historyId: historyRow.id,
          // Dung cho get_memory/save_memory (assistantTools.ts) - doc/ghi User.memories dung nguoi
          // dang chat, khong phai id cua khach (khac han cac tool CSKH Facebook/Zalo).
          userId,
        },
        history,
        reply,
        extraSystemPrompt: extraSystemPromptParts.length > 0 ? extraSystemPromptParts.join("\n\n") : undefined,
      };

      try {
        const result = await new BaseAgent(chatAgent).run(context, finalMessage, parsed.data.imageUrl || undefined);
        const resultObj: any = typeof result === "string" ? { action: "chat", message: result } : result;

        if (resultObj.action === "request_fields_pending" || resultObj.action === "test_request_pending") {
          // Tool (read_fields/request_visual_qa) da tu bat SSE rieng va gui du du lieu can thiet
          // TRUOC khi nem loi de dung loop - khong gui them "done" o day. Cuoc hoi thoai CHUA xong,
          // dang cho frontend gui tiep 1 request /messages moi voi isToolResponse=true + historyId
          // nay de resume (xem BaseAgent.run() tu dong noi context.meta.toolData vao message).
          await prisma.adminChatHistory.update({ where: { id: historyRow.id }, data: { status: "pending" } });
        } else {
          const responseText = resultObj.message || JSON.stringify(resultObj);
          // resultObj.actions (BaseAgent.runLoop()) = qua trinh goi tool + ket qua cua LUOT NAY -
          // luu vao metadata (cot JSON dung chung, xem model AdminChatHistory) de get_chat_history
          // doc lai duoc o cac luot sau, khong chi doc cau tra loi cuoi.
          const metadata = Array.isArray(resultObj.actions) && resultObj.actions.length > 0 ? JSON.stringify({ actions: resultObj.actions }) : undefined;
          await prisma.adminChatHistory.update({
            where: { id: historyRow.id },
            data: { assistantResponse: responseText, status: "success", ...(metadata ? { metadata } : {}) },
          });
          sseWrite({ step: "done", payload: resultObj });
        }
      } catch (err: any) {
        await prisma.adminChatHistory.update({
          where: { id: historyRow.id },
          data: { status: "error", errorMessage: err.message },
        });
        sseWrite({ step: "error", label: "Lỗi AI: " + err.message });
      }

      reply.raw.end();
      return reply;
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

  // Frontend (ai-chat-widget.liquid) goi route nay sau khi tool "request_visual_qa" tam dung
  // luong (mo iframe preview that, bat loi console/runtime, chup anh) - chi de UPLOAD anh chup
  // (base64 -> URL that), KHONG con dung co che cho dong bo (emitter) nhu truoc: frontend tu POST
  // tiep 1 request /messages moi voi historyId + toolData {screenshot: <url>, errors} de resume.
  app.post(
    "/admin/api/ai-chat/preview-result",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({
        errors: z.array(z.string()).default([]),
        // data URL JPEG tu html2canvas (frontend), vd "data:image/jpeg;base64,...."
        screenshot: z.string().optional().nullable(),
      });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: "Invalid parameters" });
      }

      let screenshotUrl: string | null = null;
      if (parsed.data.screenshot) {
        const match = parsed.data.screenshot.match(/^data:(image\/[a-z]+);base64,(.+)$/);
        if (match) {
          try {
            const { url } = await saveAiChatImage(Buffer.from(match[2], "base64"), match[1]);
            screenshotUrl = `${request.protocol}://${request.hostname}${url}`;
          } catch (err) {
            // Anh loi thi bo qua, van tra ve loi console (khong chan) - xem
            // services/mediaStorage.ts (vd qua 8MB, sai dinh dang).
          }
        }
      }

      return reply.send({ screenshotUrl, errors: parsed.data.errors });
    }
  );

  // Upload anh dinh kem trong khung chat admin (ai-chat-widget.liquid) - truoc day nam trong
  // plugin "admin-ai-chat" (da bi go bo), va thieu preHandler requireRole("admin") o ban goc.
  app.post(
    "/admin/api/ai-chat/upload",
    { preHandler: requireRole("admin"), config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!request.isMultipart()) return reply.code(400).send({ error: "Request is not multipart" });

      const parts = request.parts();
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
        const uploadedFile = await saveAiChatImage(partBuffer, partMime);
        return { url: uploadedFile.url };
      } catch (e: any) {
        return reply.code(400).send({ error: e.message || "Lỗi upload file" });
      }
    }
  );
}
