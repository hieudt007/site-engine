import { MCPTool } from "../core/ToolRegistry.js";
import { webSearch } from "../core/aiClient.js";

export const webSearchTool: MCPTool = {
  name: "web_search",
  description: "{\"query\": \"keyword\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "web_search", type: "tool", isActive: true },
    });
    if (!config) return "Error: web_search tool not configured or disabled.";
    if (!args.query) return "Error: missing query.";
    try {
      return await webSearch(config, args.query);
    } catch (err: any) {
      return `Error searching: ${err.message}`;
    }
  },
};
