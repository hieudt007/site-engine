import { ToolRegistry } from "../core/ToolRegistry.js";
import { webSearchTool } from "./webSearchTool.js";
import { webFetchTool } from "./webFetchTool.js";
import { generateImageTool } from "./generateImageTool.js";
import { generateVideoTool } from "./generateVideoTool.js";
import { createEmbeddingTool } from "./createEmbeddingTool.js";
import { readFieldsTool, fillFormTool, requestVisualQaTool, getCurrentPageTool, getChatHistoryTool, finishSubtaskTool, getMemoryTool, saveMemoryTool, getMenuHelpTool, getWebsiteInfoTool } from "./assistantTools.js";
import { visualQaTool, analyzeLayoutTool, getDesignSystemTool } from "./uiuxTools.js";
import { getPostTool, createDraftPostTool } from "./contentTools.js";
import { createAutomationTool, updateAutomationTool, deleteAutomationTool, listAutomationsTool } from "./automationTools.js";
import { listFilesTool, readFilesTool, searchCodeTool, replaceCodeTool, overwriteFileTool } from "./fileTools.js";
import { searchProductTool, getProductTool, checkOrderTool, createLeadTool, createOrderTool, markAsSpamTool } from "./customerSupportTools.js";
import { callAgentTool, useSkillTool } from "./agentTools.js";

// Đăng ký toàn bộ Tools vào Registry
const allTools = [
  webSearchTool,
  webFetchTool,
  generateImageTool,
  generateVideoTool,
  createEmbeddingTool,
  readFieldsTool,
  fillFormTool,
  getChatHistoryTool,
  getCurrentPageTool,
  finishSubtaskTool,
  getMemoryTool,
  saveMemoryTool,
  getMenuHelpTool,
  getWebsiteInfoTool,
  callAgentTool,
  useSkillTool,
  requestVisualQaTool,
  visualQaTool,
  analyzeLayoutTool,
  getDesignSystemTool,
  getPostTool,
  createDraftPostTool,
  createAutomationTool,
  updateAutomationTool,
  deleteAutomationTool,
  listAutomationsTool,
  listFilesTool,
  readFilesTool,
  searchCodeTool,
  replaceCodeTool,
  overwriteFileTool,
  searchProductTool,
  getProductTool,
  checkOrderTool,
  createLeadTool,
  createOrderTool,
  markAsSpamTool,
];

allTools.forEach(tool => ToolRegistry.register(tool));

export { ToolRegistry };
