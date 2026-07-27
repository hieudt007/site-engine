import { MCPTool } from "../core/ToolRegistry.js";
import { webFetch } from "../core/aiClient.js";

export const webFetchTool: MCPTool = {
  name: "webfetch",
  description: "{\"url\": \"https://...\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "webfetch", type: "tool", isActive: true },
    });
    if (!config) return "Error: webfetch tool not configured or disabled.";
    if (!args.url) return "Error: missing url.";
    try {
      return await webFetch(config, args.url);
    } catch (err: any) {
      return `Error fetching page: ${err.message}`;
    }
  },
};
