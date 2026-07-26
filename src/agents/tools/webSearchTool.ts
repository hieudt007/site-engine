import { MCPTool } from "../core/ToolRegistry.js";
import { webSearch } from "../core/aiClient.js";

export const webSearchTool: MCPTool = {
  name: "web_search",
  description: "Tìm kiếm web. Tham số: {\"query\": \"từ khóa\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "web_search", type: "tool", isActive: true },
    });
    if (!config) return "Lỗi: Tool web_search chưa được cấu hình hoặc bị tắt.";
    if (!args.query) return "Lỗi: Thiếu tham số query.";
    try {
      return await webSearch(config, args.query);
    } catch (err: any) {
      return `Lỗi khi tìm kiếm: ${err.message}`;
    }
  },
};
