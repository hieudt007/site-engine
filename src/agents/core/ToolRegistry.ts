import { AgentContext } from "./BaseAgent.js";

export interface MCPTool {
  name: string;
  description: string; // The description and args schema as a string for the prompt
  execute: (args: Record<string, any>, context: AgentContext) => Promise<string>;
  // true = tool nhay cam (vd doc/ghi file) - KHONG hien ra o UI cho admin gan vao allowedTools
  // cua bat ky agent nao (xem agentsUi.ts loc allTools truoc khi render agent-edit.liquid). Chi
  // gan duoc bang cach ghi thang vao DB (migration/seed) - khong co duong nao qua UI/API.
  isSystem?: boolean;
}

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
    let prompt = `ĐỊNH DẠNG GỌI CÔNG CỤ:
# TOOL_CALL
## name
[tên_công_cụ]
## args
[tham_số_JSON]
## next_task
[Tuỳ chọn - chỉ điền khi bạn đang tự chia nhỏ 1 việc lớn thành nhiều bước và biết rõ bước kế tiếp.]

DANH SÁCH CÔNG CỤ HỖ TRỢ:\n`;
    tools.forEach(t => {
      prompt += `- \`${t.name}\`: ${t.description}\n`;
    });
    return prompt;
  }
}
