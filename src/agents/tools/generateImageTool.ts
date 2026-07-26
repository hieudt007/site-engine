import { MCPTool } from "../core/ToolRegistry.js";

export const generateImageTool: MCPTool = {
  name: "generate_image",
  description: "Tạo ảnh minh họa. Tham số: {\"prompt\": \"mô tả ảnh\"}",
  execute: async (args, context) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "generate_image", type: 'tool', isActive: true }
    });
    if (!config) return `Lỗi: Tool image không tồn tại hoặc bị tắt.`;
    return `Kết quả tạo ảnh: ${args.prompt} (Provider: ${config.provider})`;
  }
};
