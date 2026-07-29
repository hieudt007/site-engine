import { MCPTool } from "../core/ToolRegistry.js";
import { generateVideo } from "../core/aiClient.js";

export const generateVideoTool: MCPTool = {
  name: "generate_video",
  description: "{\"prompt\": \"video description\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "generate_video", type: "tool", isActive: true },
    });
    if (!config) return "Error: generate_video tool not configured or disabled.";
    if (!args.prompt) return "Error: missing prompt.";
    try {
      const url = await generateVideo(config, args.prompt);
      return `Video generated: ${url}`;
    } catch (err: any) {
      return `Error generating video: ${err.message}`;
    }
  },
};
