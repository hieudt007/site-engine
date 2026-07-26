import { MCPTool } from "../core/ToolRegistry.js";

export const getPostTool: MCPTool = {
  name: "get_post",
  description: "Đọc bài viết cũ. Tham số: {\"id\": \"id_bài_viết\"}",
  execute: async (args, context) => {
    const postId = args.id;
    if (!postId) return "Lỗi: Thiếu tham số id.";
    return `Nội dung hiện tại của bài viết [${postId}]:\n<h1>Bài viết mẫu</h1><p>Đây là nội dung cũ...</p>`;
  }
};

export const seoAuditTool: MCPTool = {
  name: "seo_audit",
  description: "Kiểm tra chuẩn SEO. Tham số: {\"content\": \"nội dung html\", \"keyword\": \"từ khóa\"}",
  execute: async (args, context) => {
    return "Kết quả kiểm tra SEO: Đạt yêu cầu (Mock).";
  }
};
