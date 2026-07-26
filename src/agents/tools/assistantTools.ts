import fs from "node:fs";
import path from "node:path";
import { MCPTool } from "../core/ToolRegistry.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";

// Gop context.history (lich su chat CU, tu cac luot truoc do) thanh 1 khoi van ban duy nhat, dang
// "USER:<noi dung>\n\nASSISTANT:<noi dung>" - dung rieng cho getChatHistoryTool ben duoi. Neu 1
// item.content la mang (vd sau nay luu truc tiep "messages" cua REPLY_TO_USER thay vi da gop san
// thanh string) thi tach moi phan tu thanh 1 dong ASSISTANT: rieng.
function formatHistoryBlock(history: ChatHistoryItem[]): string {
  if (!history.length) return "";
  const lines: string[] = [];
  for (const item of history) {
    const label = item.role === "user" ? "USER" : "ASSISTANT";
    const content: unknown = item.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        lines.push(`${label}:${part}`);
      }
    } else {
      lines.push(`${label}:${content}`);
    }
  }
  return lines.join("\n\n");
}

// Ghi lai CHINH XAC args ma AI vua goi read_fields - GHI DE (khong noi tiep), dung khi debug vi
// debug-ai/ai_output.log co the bi ghi de boi request resume ngay sau do truoc khi kip xem.
function logReadFieldsCall(fields: unknown): void {
  try {
    const dir = path.join(process.cwd(), "debug-ai");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "read_fields_call.log"),
      `${new Date().toISOString()}\nAI goi read_fields voi fields: ${JSON.stringify(fields)}\n`,
      "utf-8"
    );
  } catch {}
}

export const readFieldsTool: MCPTool = {
  name: "read_fields",
  description: "Đọc giá trị form hiện tại. Tham số: {\"fields\": [\"trường_1\", \"trường_2\"]}",
  execute: async (args, context) => {
    const fields: string[] = Array.isArray(args.fields) ? args.fields : [];
    logReadFieldsCall(fields);
    // KHONG fallback doc "tat ca field" khi AI goi rong - se lam lo du lieu nhay cam (vd apiKey)
    // vao thang prompt gui cho AI ngoai. Bat AI phai tu chi ro tung field can, tra loi ro de no
    // tu goi lai dung cach thay vi doan mo lay het.
    if (fields.length === 0) {
      return "Lỗi: Bạn phải liệt kê rõ TÊN từng field cần đọc trong tham số \"fields\" (không được để rỗng).";
    }
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({
        step: "read_request",
        payload: { fields, historyId: context.meta?.historyId ?? null }
      })}\n\n`);
    }
    throw new Error("PAUSE_FOR_REQUEST_FIELDS");
  }
};

export const fillFormTool: MCPTool = {
  name: "fill_form",
  description: "Điền form. Tham số: {\"form_name\": \"tên\", \"fields\": {\"trường\": \"giá trị\"}}",
  execute: async (args, context) => {
    const fields = args.fields || {};
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({ 
        step: "form_fill", 
        payload: { action: "fill_form", formName: args.form_name, fields }
      })}\n\n`);
    }
    return `ĐÃ ĐIỀN FORM TỰ ĐỘNG LÊN MÀN HÌNH NGƯỜI DÙNG: ${JSON.stringify(fields)}\nNgười dùng sẽ tự xem lại và bấm Save. Bạn không cần làm gì thêm.`;
  }
};

export const requestVisualQaTool: MCPTool = {
  name: "request_visual_qa",
  description: "Chụp ảnh màn hình để test UX/UI. Tham số: {\"url\": \"đường_dẫn\"}",
  execute: async (args, context) => {
    const url = args.url || "";
    if (!url) return "Lỗi: Thiếu url.";
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({
        step: "test_request",
        payload: { action: "test_request", page: url, historyId: context.meta?.historyId ?? null }
      })}\n\n`);
    }
    throw new Error("PAUSE_FOR_QA");
  }
};

export const getCurrentPageTool: MCPTool = {
  name: "get_current_page",
  description: "Kiểm tra xem người dùng đang ở trang nào trong hệ thống. Trả về URL và Tiêu đề trang hiện tại.",
  execute: async (args, context) => {
    return JSON.stringify({
      url: context.meta?.pageUrl || "Không xác định",
      title: context.meta?.pageTitle || "Không xác định",
    });
  }
};

// Lich su chat (context.history) khong con tu dong nhet vao moi lan goi AI - tach thanh tool rieng
// de AI tu goi khi can (xem formatHistoryBlock o tren). context.history CHI chua cac luot CU (tin
// nhan hien tai dang xu ly KHONG nam trong day - cac caller nhu aiChat.ts tu loc bo truoc khi
// truyen vao run()), nen tool nay khong bao gio tra ve tin nhan hien tai.
const DEFAULT_HISTORY_NUMBER = 10;
const DEFAULT_HISTORY_OFFSET = 0;

export const getChatHistoryTool: MCPTool = {
  name: "get_chat_history",
  description:
    'Xem lại lịch sử chat CŨ với user (không bao gồm tin nhắn hiện tại). Tham số (tuỳ chọn): {"number": 10, "offset": 0} - "number" = số tin muốn lấy (mặc định 10), "offset" = bỏ qua bao nhiêu tin gần nhất trước khi lấy, dùng khi cần xem xa hơn về trước (mặc định 0).',
  execute: async (args, context) => {
    const number = Number.isFinite(args.number) ? Math.max(1, Math.floor(args.number)) : DEFAULT_HISTORY_NUMBER;
    const offset = Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : DEFAULT_HISTORY_OFFSET;

    const history = context.history || [];
    const end = history.length - offset;
    const start = Math.max(0, end - number);
    const sliced = history.slice(Math.max(0, start), Math.max(0, end));

    const block = formatHistoryBlock(sliced);
    return block || "(Không có lịch sử chat trong khoảng yêu cầu.)";
  },
};
