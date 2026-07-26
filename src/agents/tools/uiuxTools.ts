import { MCPTool } from "../core/ToolRegistry.js";
import { resolveDesignSystem, formatDesignSystem } from "./uiuxSearch.js";

export const visualQaTool: MCPTool = {
  name: "visual_qa",
  description: "Yêu cầu gửi ảnh để đánh giá QA. Tham số: {\"url\": \"đường dẫn web\"}",
  execute: async (args, context) => {
    return `Tôi là Giám đốc Mỹ thuật. Vui lòng gửi ảnh màn hình để tôi đánh giá.`;
  }
};

export const analyzeLayoutTool: MCPTool = {
  name: "analyze_layout",
  description: "Phân tích HTML/Liquid tĩnh. Tham số: {\"filename\": \"templates/index.liquid\"}",
  execute: async (args, context) => {
    return `(Tính năng phân tích tĩnh đang được xây dựng)`;
  }
};

export const getDesignSystemTool: MCPTool = {
  name: "get_design_system",
  description: "Tra cứu Design System. Tham số: {\"query\": \"modern ecommerce\"}",
  execute: async (args, context) => {
    const query = args.query || "";
    const system = await resolveDesignSystem(query);
    return formatDesignSystem(system);
  }
};
