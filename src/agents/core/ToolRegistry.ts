import { AgentContext } from "./BaseAgent.js";

export interface MCPTool {
  name: string;
  description: string; // The description and args schema as a string for the prompt
  execute: (args: Record<string, any>, context: AgentContext) => Promise<string>;
  // true = tool nhay cam (vd doc/ghi file) - KHONG hien ra o UI cho admin gan vao allowedTools
  // cua bat ky agent nao (xem agentsUi.ts loc allTools truoc khi render agent-edit.liquid). Chi
  // gan duoc bang cach ghi thang vao DB (migration/seed) - khong co duong nao qua UI/API.
  isSystem?: boolean;
  // JSON Schema THAT cho tham so (dung cho "tools" param cua native tool-calling, xem aiClient.ts/
  // BaseAgent.ts) - KHONG bat buoc khai bao rieng: neu bo trong, dung schema chung "object bat ky"
  // (generic permissive) va "description" (van la nguon huong dan chinh cho AI ve hinh dang args,
  // giu nguyen dinh dang tu do nhu cu thay vi viet lai schema chi tiet cho tung tool - 9Router/
  // provider chi can 1 JSON Schema HOP LE de kich hoat tool-calling native, khong bat buoc phai
  // strict tuyet doi tung field).
  parameters?: Record<string, any>;
}

const GENERIC_TOOL_PARAMETERS = { type: "object", properties: {}, additionalProperties: true };

export class ToolRegistry {
  private static tools: Map<string, MCPTool> = new Map();

  static register(tool: MCPTool) {
    this.tools.set(tool.name, tool);
  }

  static getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  static getAllTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  static getToolsByName(names: string[]): MCPTool[] {
    return names.map(n => this.getTool(n)).filter(t => t !== undefined) as MCPTool[];
  }

  static formatToolPrompt(names: string[]): string {
    const tools = this.getToolsByName(names);
    if (tools.length === 0) return "";
    let prompt = `AVAILABLE TOOLS:\n`;
    tools.forEach(t => {
      prompt += `- \`${t.name}\`: ${t.description}\n`;
    });
    return prompt;
  }

  // Chuyen danh sach tool (theo allowedTools cua agent) thanh dung format "tools" cua native
  // tool-calling (OpenAI-compatible, dung qua 9Router - xem thao luan thiet ke: 9Router tu dich
  // sang dung format provider dich that su, site-engine chi can noi 1 thu tieng OpenAI-compatible).
  static getOpenAiToolDefs(names: string[]): { type: "function"; function: { name: string; description: string; parameters: Record<string, any> } }[] {
    return this.getToolsByName(names).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters || GENERIC_TOOL_PARAMETERS,
      },
    }));
  }
}
