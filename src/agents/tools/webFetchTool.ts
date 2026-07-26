import { MCPTool } from "../core/ToolRegistry.js";
import { webFetch } from "../core/aiClient.js";

export const webFetchTool: MCPTool = {
  name: "webfetch",
  description: "Tải và đọc nội dung 1 trang web. Tham số: {\"url\": \"https://...\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "webfetch", type: "tool", isActive: true },
    });
    if (!config) return "Lỗi: Tool webfetch chưa được cấu hình hoặc bị tắt.";
    if (!args.url) return "Lỗi: Thiếu tham số url.";
    try {
      return await webFetch(config, args.url);
    } catch (err: any) {
      return `Lỗi khi tải trang: ${err.message}`;
    }
  },
};
