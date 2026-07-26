import { MCPTool } from "../core/ToolRegistry.js";

export const webSearchTool: MCPTool = {
  name: "web_search",
  description: "Tìm kiếm web. Tham số: {\"query\": \"từ khóa\"}",
  execute: async (args, context) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "web_search", type: 'tool', isActive: true }
    });
    if (!config) return `Lỗi: Tool search không tồn tại hoặc bị tắt.`;
    return `Kết quả search cho: ${args.query} (Provider: ${config.provider})`;
  }
};
