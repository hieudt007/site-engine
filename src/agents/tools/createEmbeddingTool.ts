import { MCPTool } from "../core/ToolRegistry.js";
import { createEmbedding } from "../core/aiClient.js";

export const createEmbeddingTool: MCPTool = {
  name: "create_embedding",
  description: "{\"input\": \"text to embed\"}",
  execute: async (args) => {
    const { prisma } = await import("../../db.js");
    const config = await prisma.agent.findFirst({
      where: { key: "create_embedding", type: "tool", isActive: true },
    });
    if (!config) return "Error: create_embedding tool not configured or disabled.";
    if (!args.input) return "Error: missing input.";
    try {
      return await createEmbedding(config, args.input);
    } catch (err: any) {
      return `Error creating embedding: ${err.message}`;
    }
  },
};
