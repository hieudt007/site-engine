import { MCPTool } from "../core/ToolRegistry.js";

export const readFieldsTool: MCPTool = {
  name: "read_fields",
  description: "Đọc giá trị form hiện tại. Tham số: {\"fields\": [\"trường_1\", \"trường_2\"]}",
  execute: async (args, context) => {
    const fields = args.fields || [];
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({ 
        step: "read_request", 
        payload: { fields }
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
        payload: { action: "test_request", page: url }
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
