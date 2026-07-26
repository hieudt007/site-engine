import { ToolRegistry } from "../core/ToolRegistry.js";
import { webSearchTool } from "./webSearchTool.js";
import { webFetchTool } from "./webFetchTool.js";
import { generateImageTool } from "./generateImageTool.js";
import { readFieldsTool, fillFormTool, requestVisualQaTool, getCurrentPageTool, getChatHistoryTool } from "./assistantTools.js";
import { visualQaTool, analyzeLayoutTool, getDesignSystemTool } from "./uiuxTools.js";
import { getPostTool } from "./contentTools.js";
import { listFilesTool, readFilesTool, searchCodeTool, replaceCodeTool, overwriteFileTool } from "./fileTools.js";
import { searchProductTool, getProductTool, checkOrderTool, createLeadTool, markAsSpamTool } from "./customerSupportTools.js";

// Đăng ký toàn bộ Tools vào Registry
const allTools = [
  webSearchTool,
  webFetchTool,
  generateImageTool,
  readFieldsTool,
  fillFormTool,
  getChatHistoryTool,
  requestVisualQaTool,
  visualQaTool,
  analyzeLayoutTool,
  getDesignSystemTool,
  getPostTool,
  listFilesTool,
  readFilesTool,
  searchCodeTool,
  replaceCodeTool,
  overwriteFileTool,
  searchProductTool,
  getProductTool,
  checkOrderTool,
  createLeadTool,
  markAsSpamTool,
];

allTools.forEach(tool => ToolRegistry.register(tool));

export { ToolRegistry };
