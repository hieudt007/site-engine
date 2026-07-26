import { FastifyInstance } from "fastify";
import { z } from "zod";
import { EventEmitter } from "node:events";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { callAgent, generateImage, webFetch, webSearch } from "../../agents/core/aiClient.js";
import { InvalidUploadError, saveAiChatImage } from "../../services/mediaStorage.js";

// Dung cho tool "check_preview": server gui yeu cau mo URL preview len frontend qua SSE
// (step: "tool_open_preview"), roi CHO frontend mo iframe that, bat loi console/runtime, gui
// ket qua ve qua POST /admin/api/ai-chat/preview-result - route do emit vao day de danh thuc
// Promise dang cho trong vong lap chinh. Key theo historyRow.id (moi luot chat 1 id rieng).
const previewCheckEmitter = new EventEmitter();
// KHONG dung "^" - pageUrl frontend gui len la URL TUYET DOI (window.location.href, vd
// "http://host/admin/themes/xyz/edit"), khong phai chi pathname, nen khong the anchor tu dau
// chuoi duoc.
const THEME_EDIT_PAGE_RE = /\/admin\/themes\/([^/]+)\/edit/;

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

// ─── Parse phản hồi của AI ────────────────────────────────────────────────────
// AI trả về dạng text thuần, không phải JSON.
// Format chuẩn: TOOL: <tên> hoặc AGENT: <key> hoặc FILL_FORM: hoặc CHAT:
function parseAgentResponse(raw: string): Record<string, any> {
  const trim = raw.trim();

  // TOOL: <name>\nQUERY: <input>\nMESSAGE: <label>
  const toolMatch = trim.match(/^TOOL:\s*(\S+)\s*\nQUERY:\s*([\s\S]*?)(?:\nMESSAGE:\s*(.+))?$/m);
  if (toolMatch) {
    return {
      action: "tool",
      tool: toolMatch[1].trim().toLowerCase(),
      query: toolMatch[2].trim(),
      message: toolMatch[3]?.trim() || "",
    };
  }

  // AGENT: <key>\nQUERY: <input>\nMESSAGE: <label>
  const agentMatch = trim.match(/^AGENT:\s*(\S+)\s*\nQUERY:\s*([\s\S]*?)(?:\nMESSAGE:\s*(.+))?$/m);
  if (agentMatch) {
    return {
      action: "agent",
      agentKey: agentMatch[1].trim().toLowerCase(),
      query: agentMatch[2].trim(),
      message: agentMatch[3]?.trim() || "",
    };
  }

  // FILL_FORM:\nMESSAGE: ...\n<<<< FIELD: id >>>>\nvalue\n====
  if (trim.startsWith("FILL_FORM:") || trim.includes("\nFILL_FORM:")) {
    const msgMatch = trim.match(/MESSAGE:\s*(.+?)(?=\n|$)/);
    const data: Record<string, string> = {};
    const blockRegex = /<<<< FIELD:\s*(.+?)\s*>>>>\n([\s\S]*?)(?=\n====|\n<<<<|$)/g;
    let m;
    while ((m = blockRegex.exec(trim)) !== null) {
      data[m[1].trim()] = m[2].trim();
    }
    return { action: "fill_form", message: msgMatch?.[1].trim() || "", data };
  }

  // CHAT:\n<text>
  const chatMatch = trim.match(/^CHAT:\s*([\s\S]*)$/m);
  if (chatMatch) {
    return { action: "chat", message: chatMatch[1].trim() };
  }

  // Fallback: coi toàn bộ text là chat
  return { action: "chat", message: trim };
}

// ─── Đọc section trong AGENT_MANUAL.md ────────────────────────────────────────
async function readManualSection(heading: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const content = await readFile(join(process.cwd(), "assets", "data", "AGENT_MANUAL.md"), "utf-8");
    const lines = content.split("\n");
    let section = "";
    let capturing = false;
    for (const line of lines) {
      if (line.startsWith("#")) {
        if (line.toLowerCase().includes(heading.toLowerCase())) { capturing = true; continue; }
        else if (capturing) break;
      }
      if (capturing) section += line + "\n";
    }
    return section.trim() || "Không tìm thấy nội dung.";
  } catch {
    return "Không thể đọc file tài liệu.";
  }
}

// ─── Gọi sub-agent và trả về phản hồi ────────────────────────────────────────
// chat agent gọi hàm này với:
//   agentKey  = key của sub-agent trong DB (content / developer / design / tester)
//   query     = yêu cầu cụ thể chat agent muốn sub-agent làm
//   pageUrl   = URL hiện tại của user (để check developer guard)
//   toolData  = dữ liệu form đã đọc từ frontend (nếu có)
//   imageUrl  = URL TUYỆT ĐỐI ảnh đính kèm (nếu có) - dùng cho tester xem ảnh chụp preview
async function invokeSubAgent(
  agentKey: string,
  query: string,
  pageUrl: string | null | undefined,
  toolData: Record<string, any> | null | undefined,
  imageUrl?: string | null
): Promise<Record<string, any>> {

  // Guard: "design" (Liquid + TailwindCSS cho theme) chỉ hoạt động khi user đang ở trang Theme
  // Editor - dung chung THEME_EDIT_PAGE_RE (khong anchor "^", vi pageUrl la URL tuyet doi).
  // LUU Y: "developer" la agent KHAC (sinh raw HTML cho landing page/custom content trong
  // post-edit.liquid/page-edit.liquid/product-edit.liquid), KHONG lien quan Theme Editor.
  if (agentKey === "design") {
    if (!pageUrl?.match(THEME_EDIT_PAGE_RE)) {
      return {
        action: "chat",
        message: `Tính năng chỉnh sửa giao diện theme chỉ dùng được ở trang Theme Editor. <a href="/admin/settings/theme">Đến trang Quản lý Giao diện</a>`,
      };
    }
  }

  const subAgent = await prisma.agent.findFirst({ where: { isActive: true, key: agentKey } });
  if (!subAgent) {
    return { action: "chat", message: `Agent "${agentKey}" chưa được tạo hoặc chưa được bật trong hệ thống.` };
  }

  // Mỗi sub-agent có format output riêng, append vào system prompt của nó
  const outputFormatByKey: Record<string, string> = {
    content: [
      "\n\n=== OUTPUT FORMAT ===",
      "Điền kết quả vào form theo đúng định dạng sau:",
      "FILL_FORM:",
      "MESSAGE: <tóm tắt ngắn gọn những gì bạn đã làm>",
      "<<<< FIELD: <field_id> >>>>",
      "<nội dung>",
      "====",
      "(Lặp lại FIELD block cho từng field cần điền)",
    ].join("\n"),

    developer: [
      "\n\n=== OUTPUT FORMAT ===",
      "Ghi HTML code vào field body theo đúng định dạng:",
      "FILL_FORM:",
      "MESSAGE: <mô tả ngắn giao diện bạn vừa code>",
      "<<<< FIELD: body >>>>",
      "<raw HTML/TailwindCSS code>",
      "====",
    ].join("\n"),

    design: [
      "\n\n=== OUTPUT FORMAT ===",
      "Ghi Liquid + TailwindCSS code vào field theo định dạng:",
      "FILL_FORM:",
      "MESSAGE: <mô tả ngắn giao diện bạn vừa viết>",
      "<<<< FIELD: <field_id> >>>>",
      "<Liquid + TailwindCSS code>",
      "====",
    ].join("\n"),
  };

  const outputFormat = outputFormatByKey[agentKey] ?? "\n\nTrả lời bằng: CHAT:\n<nội dung>";
  const systemPrompt = (subAgent.systemPrompt || "") + outputFormat;

  // User message: query từ chat agent + dữ liệu form (nếu có)
  const userMessage = toolData
    ? `${query}\n\n--- Dữ liệu form hiện tại ---\n${JSON.stringify(toolData, null, 2)}`
    : query;

  // Fallback graceful neu API AI loi (rate limit/timeout/mang/...) - KHONG de loi bay thang ra
  // ngoai route SSE dang mo, vi luc do header da gui roi nen khong tra ve loi HTTP tu te duoc
  // nua, ket noi se treo/vo. Tra ve dang "chat" voi thong bao loi de vong lap chinh van tiep tuc
  // duoc (agent nay coi nhu bo qua, khong chan ca luong).
  try {
    const raw = await callAgent(subAgent, systemPrompt, userMessage, imageUrl || undefined, true);
    return parseAgentResponse(raw);
  } catch (err: any) {
    return { action: "chat", message: `Agent "${agentKey}" gặp lỗi khi gọi AI (${err?.message || "không rõ nguyên nhân"}), đã bỏ qua bước này.` };
  }
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

      const sseWrite = (data: any) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");

      const chatAgent = await prisma.agent.findFirst({ where: { isActive: true, key: "chat" } });
      if (!chatAgent) {
        sseWrite({ step: "error", label: "Không tìm thấy Chat Agent." });
        reply.raw.end();
        return reply;
      }

      // ── Đọc danh sách headings từ AGENT_MANUAL.md ──────────────────────────
      let manualHeadings: string[] = [];
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const content = await readFile(join(process.cwd(), "assets", "data", "AGENT_MANUAL.md"), "utf-8");
        manualHeadings = content.split("\n")
          .filter(l => l.startsWith("## ") || l.startsWith("### "))
          .map(l => l.replace(/^#+\s*/, "").trim());
      } catch (_) {}

      // ── Danh sách sub-agents ───────────────────────────────────────────────
      const subAgentList = [
        { key: "content",   desc: "Viết/chỉnh nội dung bài viết, mô tả sản phẩm, landing page" },
        { key: "developer", desc: "Viết raw HTML/TailwindCSS cho landing page/custom content (trang bài viết/trang tĩnh/sản phẩm ở chế độ layout tự do)" },
        { key: "design",    desc: "Viết code Liquid + TailwindCSS cho giao diện theme (layout, component, section) - chỉ dùng được ở trang Theme Editor" },
      ];

      // ── System prompt gửi cho Chat Agent ──────────────────────────────────
      const systemPrompt = [
        chatAgent.systemPrompt || "Bạn là trợ lý AI của hệ thống Site Engine.",
        parsed.data.pageTitle
          ? `\n[Context] Trang hiện tại: "${parsed.data.pageTitle}" (${parsed.data.pageUrl || ""})`
          : "",
        parsed.data.layoutMode
          ? `[Context] Layout mode: "${parsed.data.layoutMode}"`
          : "",
        parsed.data.availableFields?.length
          ? `[Context] Field IDs có thể đọc/điền trên trang: [${parsed.data.availableFields.join(", ")}]`
          : "",
        `
=== CÔNG CỤ (TOOLS) ===
Dùng đúng một trong các định dạng sau, KHÔNG dùng JSON:

1. GỌI TOOL — dùng khi cần tra cứu, tìm kiếm, tải web, tạo ảnh, đọc form:
TOOL: <tên tool>
QUERY: <nội dung truy vấn hoặc URL hoặc prompt>
MESSAGE: <thông báo cho user>

   Danh sách tools:
   - read_manual   : Tra cứu tài liệu nội bộ. Các heading hiện có:
${manualHeadings.map(h => `     • ${h}`).join("\n")}
   - read_fields   : Yêu cầu frontend gửi giá trị các field. QUERY = danh sách field IDs cách nhau bởi dấu phẩy
   - webfetch      : Tải và đọc nội dung từ URL. QUERY = URL
   - websearch     : Tìm kiếm thông tin trên web. QUERY = câu tìm kiếm
   - generate_image: Tạo ảnh AI. QUERY = mô tả ảnh bằng tiếng Anh${
     THEME_EDIT_PAGE_RE.test(parsed.data.pageUrl || "")
       ? `
   - check_preview : CHỈ dùng ở trang Theme Editor. Mở trang xem trước thật trong trình duyệt, tự bắt lỗi JS/console + chụp ảnh giao diện, gửi lỗi cho Tester Agent (kỹ thuật) và ảnh cho Reviewer Agent (thẩm mỹ/UX) chấm riêng, trả về nhận xét của cả hai. QUERY = loại trang cần kiểm tra, một trong: home, blog-list, blog-post, blog-category, page, products-list, product-category, product-detail, cart, order-confirmation, 404. Dùng NGAY SAU KHI vừa sửa code giao diện xong để xác nhận không có lỗi trước khi báo cáo cho user.`
       : ""
   }

2. GỌI SUB-AGENT — dùng khi cần chuyên gia xử lý:
AGENT: <key>
QUERY: <yêu cầu chi tiết cho agent đó>
MESSAGE: <thông báo cho user>

   Danh sách agents:
${subAgentList.map(a => `   - ${a.key}: ${a.desc}`).join("\n")}

3. ĐIỀN FORM TRỰC TIẾP — dùng khi bạn đã có đủ dữ liệu:
FILL_FORM:
MESSAGE: <thông báo cho user>
<<<< FIELD: <field_id> >>>>
<giá trị>
====

4. TRẢ LỜI THÔNG THƯỜNG:
CHAT:
<câu trả lời ngắn gọn, dễ hiểu, không dùng thuật ngữ kỹ thuật>

NOTE: Chỉ dùng AGENT khi cần xử lý chuyên sâu. Với câu hỏi đơn giản hãy trả lời thẳng bằng CHAT:.`,
      ].join("\n");

      // ── Lịch sử chat ───────────────────────────────────────────────────────
      const contextItems = await prisma.adminChatHistory.findMany({
        where: { userId, entityId: parsed.data.entityId || null },
        orderBy: { id: "desc" },
        take: 5,
      });
      const originalMessage = parsed.data.originalMessage || parsed.data.message;
      const prevItems = contextItems.filter(
        i => !(i.userMessage === originalMessage && i.status === "pending")
      );
      let historyStr = "";
      if (prevItems.length > 0) {
        historyStr = "\n\n--- Lịch sử trò chuyện ---\n";
        for (const item of [...prevItems].reverse()) {
          historyStr += `User: ${item.userMessage}\n`;
          if (item.assistantResponse && item.status !== "error") {
            historyStr += `Assistant: ${item.assistantResponse}\n`;
          }
        }
      }

      // ── User prompt ─────────────────────────────────────────────────────────
      let userPrompt = parsed.data.isToolResponse
        ? `Yêu cầu: ${originalMessage}\nDữ liệu field đã đọc từ trang:\n${JSON.stringify(parsed.data.toolData, null, 2)}`
        : parsed.data.message;

      // ── Tạo history row ────────────────────────────────────────────────────
      let historyRow: any = parsed.data.historyId
        ? await prisma.adminChatHistory.findUnique({ where: { id: parsed.data.historyId } })
        : await prisma.adminChatHistory.create({
            data: {
              userId,
              entityId: parsed.data.entityId || null,
              userMessage: originalMessage,
              imageUrl: parsed.data.imageUrl,
              status: "pending",
            },
          });

      // ── Mặc định gọi Sub-Agent (bỏ qua orchestrator) nếu được frontend chỉ định ──
      if (parsed.data.nextAgent && parsed.data.nextAgent !== "chat") {
        sseWrite({ step: "thinking", label: `Agent ${parsed.data.nextAgent} đang xử lý...` });
        try {
          const subResp = await invokeSubAgent(parsed.data.nextAgent, userPrompt, parsed.data.pageUrl, parsed.data.toolData);
          
          await prisma.adminChatHistory.update({
            where: { id: historyRow.id },
            data: { 
              assistantResponse: subResp.message, 
              status: "success" 
            },
          });
          
          sseWrite({ step: "done", payload: subResp });
          reply.raw.end();
          return reply;
        } catch (e: any) {
          await prisma.adminChatHistory.update({
            where: { id: historyRow.id },
            data: { status: "error", errorMessage: e.message },
          });
          sseWrite({ step: "error", label: "Lỗi AI: " + e.message });
          reply.raw.end();
          return reply;
        }
      }

      // ── Vòng lặp chính ─────────────────────────────────────────────────────
      const MAX_LOOPS = 5;
      const fullSystemPrompt = systemPrompt + historyStr;

      for (let loop = 0; loop < MAX_LOOPS; loop++) {
        sseWrite({ step: "thinking", label: "AI đang xử lý..." });

        let responseJson: Record<string, any>;
        try {
          const raw = await callAgent(chatAgent, fullSystemPrompt, userPrompt, parsed.data.imageUrl || undefined, true);
          responseJson = parseAgentResponse(raw);
        } catch (e: any) {
          await prisma.adminChatHistory.update({
            where: { id: historyRow.id },
            data: { status: "error", errorMessage: e.message },
          });
          sseWrite({ step: "error", label: "Lỗi AI: " + e.message });
          reply.raw.end();
          return reply;
        }

        // ── Dispatch TOOL ──────────────────────────────────────────────────
        if (responseJson.action === "tool") {
          const { tool, query, message } = responseJson;
          sseWrite({ step: "tool", label: message || `Đang dùng tool ${tool}...` });

          if (tool === "read_manual") {
            const result = await readManualSection(query);
            userPrompt += `\n\n[Tài liệu "${query}"]:\n${result}`;
            continue;
          }

          if (tool === "read_fields") {
            // Yêu cầu frontend đọc DOM và gửi lại
            const fields = query.split(",").map((f: string) => f.trim()).filter(Boolean);
            sseWrite({ step: "tool_request", payload: {
              action: "request_fields",
              fields,
              nextAgent: parsed.data.nextAgent || "chat",
              historyId: historyRow.id,
              message,
            }});
            reply.raw.end();
            return reply;
          }

          if (tool === "webfetch") {
            try {
              const result = await webFetch(chatAgent, query);
              userPrompt += `\n\n[Nội dung từ ${query}]:\n${String(result).slice(0, 3000)}`;
            } catch (e: any) {
              userPrompt += `\n\n[WEBFETCH lỗi]: ${e.message}`;
            }
            continue;
          }

          if (tool === "websearch") {
            try {
              const result = await webSearch(chatAgent, query);
              userPrompt += `\n\n[Kết quả tìm kiếm "${query}"]:\n${String(result).slice(0, 3000)}`;
            } catch (e: any) {
              userPrompt += `\n\n[WEBSEARCH lỗi]: ${e.message}`;
            }
            continue;
          }

          if (tool === "generate_image") {
            try {
              const imageUrl = await generateImage(chatAgent, query, "1024x1024");
              const md = `![Hình ảnh AI](${imageUrl})\n\n[Link ảnh](${imageUrl})`;
              await prisma.adminChatHistory.update({
                where: { id: historyRow.id },
                data: { assistantResponse: md, status: "success" },
              });
              sseWrite({ step: "done", payload: { action: "chat", message: md } });
            } catch (e: any) {
              sseWrite({ step: "error", label: "Lỗi tạo ảnh: " + e.message });
            }
            reply.raw.end();
            return reply;
          }

          if (tool === "check_preview") {
            const pageMatch = parsed.data.pageUrl?.match(THEME_EDIT_PAGE_RE);
            if (!pageMatch) {
              userPrompt += `\n\n[CHECK_PREVIEW lỗi]: Tool này chỉ dùng được ở trang Theme Editor.`;
              continue;
            }
            const slug = pageMatch[1];
            const page = query || "home";

            sseWrite({ step: "tool_open_preview", payload: { page, slug, historyId: historyRow.id } });

            // Cho frontend toi da 30s de mo iframe that + bat loi + chup anh + POST ve
            // /admin/api/ai-chat/preview-result, tranh treo vinh vien neu frontend loi/dong tab.
            const previewResult: { errors: string[]; screenshotUrl: string | null } = await new Promise((resolve) => {
              const timer = setTimeout(
                () => resolve({ errors: ["(Hết thời gian chờ trình duyệt phản hồi sau 30s)"], screenshotUrl: null }),
                30000
              );
              previewCheckEmitter.once(`preview-result-${historyRow.id}`, (result: { errors: string[]; screenshotUrl: string | null }) => {
                clearTimeout(timer);
                resolve(result);
              });
            });

            const errorSummary = previewResult.errors.length > 0 ? previewResult.errors.join("\n") : "Không có lỗi nào.";

            // Dung 2 agent CHUYEN TRACH RIENG, giong dung thiet ke goc: "tester" chi cham loi
            // JS/console (van ban), "reviewer" chi cham thẩm mỹ/UX qua ANH CHỤP (multimodal) -
            // khong gop chung 1 agent, de moi agent tap trung dung the manh cua no.
            const testerResult = await invokeSubAgent(
              "tester",
              `Trang vừa test: ${page}. Lỗi JS/console bắt được khi mở trang thật trong trình duyệt:\n${errorSummary}`,
              parsed.data.pageUrl,
              null
            );

            let reviewerMessage = "(không có ảnh để chấm)";
            if (previewResult.screenshotUrl) {
              const reviewerResult = await invokeSubAgent(
                "reviewer",
                `Đây là ảnh chụp giao diện thật của trang "${page}" sau khi vừa sửa. Hãy chấm thẩm mỹ/UX (màu sắc, spacing, typography, bố cục có bị lỗi/đè lên nhau không).`,
                parsed.data.pageUrl,
                null,
                previewResult.screenshotUrl
              );
              reviewerMessage = reviewerResult.message || "(không có nhận xét)";
            }

            userPrompt += `\n\n[Kết quả CHECK_PREVIEW trang "${page}"]:\n${errorSummary}` +
              `\n\n[Nhận xét từ Tester Agent (lỗi kỹ thuật)]:\n${testerResult.message || "(không có nhận xét)"}` +
              `\n\n[Nhận xét từ Reviewer Agent (thẩm mỹ/UX)]:\n${reviewerMessage}`;
            continue;
          }

          // Tool không xác định
          userPrompt += `\n\n[Tool "${tool}" không được hỗ trợ]`;
          continue;
        }

        // ── Dispatch AGENT ─────────────────────────────────────────────────
        if (responseJson.action === "agent") {
          const { agentKey, query, message } = responseJson;
          sseWrite({ step: "thinking", label: message || `Đang gọi ${agentKey} agent...` });

          const agentResult = await invokeSubAgent(
            agentKey,
            query,
            parsed.data.pageUrl,
            parsed.data.toolData
          );

          // Nếu sub-agent trả về fill_form → gửi về frontend
          if (agentResult.action === "fill_form" || agentResult.action === "chat") {
            await prisma.adminChatHistory.update({
              where: { id: historyRow.id },
              data: { assistantResponse: agentResult.message || "Xong", status: "success" },
            });
            sseWrite({ step: "done", payload: agentResult });
            reply.raw.end();
            return reply;
          }

          // Sub-agent muốn dùng thêm tool → inject vào context
          userPrompt += `\n\n[Kết quả từ ${agentKey} agent]:\n${agentResult.message || ""}`;
          continue;
        }

        // ── FILL_FORM hoặc CHAT — kết thúc ────────────────────────────────
        await prisma.adminChatHistory.update({
          where: { id: historyRow.id },
          data: {
            assistantResponse: responseJson.message || "Xong",
            status: "success",
          },
        });
        sseWrite({ step: "done", payload: responseJson });
        reply.raw.end();
        return reply;
      }

      sseWrite({ step: "error", label: "Vượt quá số vòng lặp cho phép." });
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

  // Frontend (ai-chat-widget.liquid, o trang Theme Editor) goi route nay sau khi mo thu trang
  // preview that trong iframe va bat duoc loi console/runtime (hoac khong co loi nao) - danh
  // thuc Promise dang cho trong tool "check_preview" cua vong lap /admin/api/ai-chat/messages.
  app.post(
    "/admin/api/ai-chat/preview-result",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const schema = z.object({
        historyId: z.number(),
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
            // Anh loi thi bo qua, van tiep tuc voi loi console (khong block luong test) -
            // xem services/mediaStorage.ts (vd qua 8MB, sai dinh dang).
          }
        }
      }

      previewCheckEmitter.emit(`preview-result-${parsed.data.historyId}`, { errors: parsed.data.errors, screenshotUrl });
      return reply.send({ success: true });
    }
  );
}
