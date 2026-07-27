import { MCPTool } from "../core/ToolRegistry.js";
import { generateImage } from "../core/aiClient.js";

export const generateImageTool: MCPTool = {
  name: "generate_image",
  description: "{\"prompt\": \"image description\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "generate_image", type: "tool", isActive: true },
    });
    if (!config) return "Error: generate_image tool not configured or disabled.";
    if (!args.prompt) return "Error: missing prompt.";
    try {
      const url = await generateImage(config, args.prompt, args.size || "1024x1024");
      return `Image generated: ${url}`;
    } catch (err: any) {
      return `Error generating image: ${err.message}`;
    }
  },
};
