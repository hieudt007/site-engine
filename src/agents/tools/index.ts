import { ToolRegistry } from "../core/ToolRegistry.js";
import { webSearchTool } from "./webSearchTool.js";
import { generateImageTool } from "./generateImageTool.js";
import { readFieldsTool, fillFormTool, requestVisualQaTool, getCurrentPageTool } from "./assistantTools.js";
import { visualQaTool, analyzeLayoutTool, getDesignSystemTool } from "./uiuxTools.js";
import { getPostTool, seoAuditTool } from "./contentTools.js";
import { listFilesTool, readFilesTool, searchCodeTool, replaceCodeTool, overwriteFileTool } from "./fileTools.js";

// Đăng ký toàn bộ Tools vào Registry
const allTools = [
  webSearchTool,
  generateImageTool,
  readFieldsTool,
  fillFormTool,
  requestVisualQaTool,
  visualQaTool,
  analyzeLayoutTool,
  getDesignSystemTool,
  getPostTool,
  seoAuditTool,
  listFilesTool,
  readFilesTool,
  searchCodeTool,
  replaceCodeTool,
  overwriteFileTool,
];

allTools.forEach(tool => ToolRegistry.register(tool));

export { ToolRegistry };
