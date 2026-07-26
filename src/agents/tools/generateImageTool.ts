import { MCPTool } from "../core/ToolRegistry.js";
import { generateImage } from "../core/aiClient.js";

export const generateImageTool: MCPTool = {
  name: "generate_image",
  description: "Tạo ảnh minh họa. Tham số: {\"prompt\": \"mô tả ảnh\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "generate_image", type: "tool", isActive: true },
    });
    if (!config) return "Lỗi: Tool generate_image chưa được cấu hình hoặc bị tắt.";
    if (!args.prompt) return "Lỗi: Thiếu tham số prompt.";
    try {
      const url = await generateImage(config, args.prompt, args.size || "1024x1024");
      return `Đã tạo ảnh thành công: ${url}`;
    } catch (err: any) {
      return `Lỗi khi tạo ảnh: ${err.message}`;
    }
  },
};
