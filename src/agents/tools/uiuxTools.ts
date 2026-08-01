import { MCPTool } from "../core/ToolRegistry.js";
import { resolveDesignSystem, formatDesignSystem } from "./uiuxSearch.js";

export const visualQaTool: MCPTool = {
  name: "visual_qa",
  description: "Request a screenshot for QA review. {\"url\": \"web path\"}",
  execute: async (_args, _context) => {
    return `Please send a screenshot for review.`;
  }
};

export const analyzeLayoutTool: MCPTool = {
  name: "analyze_layout",
  description: "Static HTML/Liquid analysis. {\"filename\": \"templates/index.liquid\"}",
  execute: async (_args, _context) => {
    return `(Static analysis feature under construction)`;
  }
};

export const getDesignSystemTool: MCPTool = {
  name: "get_design_system",
  description: "Look up Design System. {\"query\": \"modern ecommerce\"}",
  execute: async (args, _context) => {
    const query = args.query || "";
    const system = await resolveDesignSystem(query);
    return formatDesignSystem(system);
  }
};
