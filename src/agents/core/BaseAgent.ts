import type { Agent } from "@prisma/client";
import { callAgent } from "./aiClient.js";
import { MarkdownParser, ParsedToolCall } from "./MarkdownParser.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";
import { ToolRegistry } from "./ToolRegistry.js";

export interface AgentContext {
  meta: Record<string, any>;
  history: ChatHistoryItem[];
  reply?: import("fastify").FastifyReply;
  // Duoc BaseAgent.run() tu dien truoc khi goi tool - cac tool can goi lai AI (vd retryUntilValid)
  // dung field nay thay vi nhan agent rieng qua tham so.
  agentModel?: Agent;
}

// Huong dan dinh dang chung cho CA 4 loai hanh dong - luon noi vao system prompt cua MOI agent
// (khong chi rieng agent nao) de tranh moi subclass phai tu viet lai (truoc day DeveloperAgent tu
// viet rieng REPLY_TO_USER, de trong risk driftformat giua cac agent).
const RESPONSE_FORMAT_GUIDE = `=== ĐỊNH DẠNG PHẢN HỒI ===
Mỗi lượt trả lời CHỈ được chứa ĐÚNG MỘT khối dưới đây (không viết gì khác ngoài khối đó):

1. Điền dữ liệu vào field (post/page/product/theme...):
# FILL_FORM
## fields
### <field_id>
<giá trị>
(lặp lại ### cho từng field cần điền)
## message
<thông báo ngắn cho user biết bạn vừa làm gì>

2. Nhờ Agent khác xử lý:
# AGENT_CALL
## agent
<key_agent>
## payload
### prompt
<yêu cầu cụ thể>
## message
<thông báo ngắn>

3. Trả lời cuối cùng cho user (không cần làm gì thêm, kết thúc lượt xử lý):
# REPLY_TO_USER
<nội dung trả lời>

4. Gọi công cụ (nếu có công cụ được liệt kê bên dưới) - xem định dạng "TOOL_CALL" ở phần công cụ.
`;

export class BaseAgent {
  protected agentModel: Agent;
  protected maxSteps = 10;

  constructor(model: Agent) {
    this.agentModel = model;
  }

  public getAgentModel(): Agent {
    return this.agentModel;
  }

  // Stream "message" (AI tu giai thich dang lam gi o buoc VUA nhan duoc) ngay lap tuc.
  protected streamMessage(context: AgentContext, message: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "tool", label: message })}\n\n`);
    } catch {}
  }

  // Stream "nextTask" (viec AI du dinh lam o buoc SAU) - goi ngay TRUOC khi goi AI cho buoc tiep
  // theo, khong dung timer co dinh: luc nay tool/agent cua buoc truoc da chay xong nen thoi diem
  // hien thi tu nhien dung luc, khong doan mo timeout.
  protected streamNextTask(context: AgentContext, nextTask: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "next_task", label: nextTask })}\n\n`);
    } catch {}
  }

  protected getSystemPrompt(context?: AgentContext): string {
    let prompt = this.agentModel.systemPrompt || "";
    prompt += "\n\n" + RESPONSE_FORMAT_GUIDE;
    // Nối thêm danh sách công cụ từ ToolRegistry
    const toolPrompt = ToolRegistry.formatToolPrompt(this.agentModel.allowedTools || []);
    if (toolPrompt) {
      prompt += "\n" + toolPrompt;
    }
    return prompt;
  }
  
  protected async executeSpecificTool(toolName: string, args: Record<string, any>, context: AgentContext): Promise<string> {
     return `Lỗi: Công cụ ${toolName} chưa được đăng ký.`;
  }
  
  protected async executeTool(toolName: string, args: Record<string, any>, context: AgentContext): Promise<string> {
    const tool = ToolRegistry.getTool(toolName);
    if (tool) {
      return tool.execute(args, context);
    }
    // Fallback for legacy tools until fully migrated
    return this.executeSpecificTool(toolName, args, context);
  }
  
  protected async handleAgentCall(targetAgent: string, payload: any, context: AgentContext): Promise<string> {
    const { AgentFactory } = await import("./AgentFactory.js");
    try {
      const agent = await AgentFactory.create(targetAgent);
      if (!agent) {
        return `Lỗi: Không tìm thấy Agent [${targetAgent}] trong hệ thống.`;
      }
      
      const prompt = payload.prompt || "";
      
      // Lấy imageUrl từ dữ liệu QA nếu có
      let imgUrl = undefined;
      if (context.meta.toolData && context.meta.toolData.screenshot) {
         imgUrl = context.meta.toolData.screenshot;
      }
      const result = await agent.run(context, prompt, imgUrl);
      
      if (typeof result === 'object') {
        return JSON.stringify(result);
      }
      return result;
    } catch (e: any) {
      return `Lỗi hệ thống khi gọi Agent [${targetAgent}]: ${e.message}`;
    }
  }

  public async run(context: AgentContext, message: string, imageUrl?: string): Promise<string | object> {
    let loopCount = 0;
    context.agentModel = this.agentModel;

    // Khởi tạo context mảng tin nhắn
    const messages: any[] = [...context.history];
    let finalMessage = message;
    if (context.meta.toolData) {
       finalMessage += `\n\n--- Dữ liệu form hiện tại ---\n${JSON.stringify(context.meta.toolData, null, 2)}`;
    } else if (context.meta.availableFields && Array.isArray(context.meta.availableFields) && context.meta.availableFields.length > 0) {
       finalMessage += `\n\n--- Các trường có sẵn trên giao diện hiện tại ---\n[${context.meta.availableFields.join(', ')}]\n(Nếu cần đọc giá trị của trường nào, hãy gọi tool read_fields)`;
    }

    messages.push({
      role: "user",
      content: finalMessage,
      imageUrl: imageUrl
    });

    // Viec AI noi la se lam o buoc TIEP THEO (tu response truoc) - stream ngay TRUOC khi goi AI
    // lai o dau vong lap ke tiep, khong dung timer co dinh (xem streamNextTask).
    let pendingNextTask: string | null = null;

    while (loopCount < this.maxSteps) {
      loopCount++;

      if (pendingNextTask) {
        this.streamNextTask(context, pendingNextTask);
        pendingNextTask = null;
      }

      const systemPrompt = this.getSystemPrompt(context);

      // Gọi AI
      let rawResponse = "";
      try {
        rawResponse = await callAgent(this.agentModel, systemPrompt, JSON.stringify(messages), imageUrl, false);
      } catch (err: any) {
        return `Lỗi khi gọi AI: ${err.message}`;
      }

      // Lưu lại câu trả lời của AI vào history
      messages.push({
        role: "assistant",
        content: rawResponse
      });

      // Parse cú pháp Markdown Headings (hoặc JSON)
      const parsed = MarkdownParser.parse(rawResponse);

      if (parsed.type === "FILL_FORM") {
        this.streamMessage(context, parsed.message || "Đã điền xong form.");
        // "data" (khong phai "fields") de dong nhat shape voi action fill_form cua luong aiChat.ts
        // cu - route/frontend tieu thu ket qua nay co the tai su dung nguyen logic xu ly da co.
        return { action: "fill_form", message: parsed.message || "", data: parsed.fields || {} };
      }

      if (parsed.type === "REPLY") {
        if (context.reply) {
            context.reply.raw.write(`data: ${JSON.stringify({ step: "tool", label: "Đã có câu trả lời." })}\n\n`);
        }
        return parsed.content;
      }

      if (parsed.type === "AGENT") {
        const targetAgent = parsed.tool || "";
        this.streamMessage(context, parsed.message || `Đang bàn giao công việc cho Agent [${targetAgent}]...`);
        pendingNextTask = parsed.nextTask;

        const agentResponse = await this.handleAgentCall(targetAgent, parsed.args, context);

        messages.push({
          role: "user",
          content: `Kết quả từ Agent [${targetAgent}]:\n${agentResponse}`
        });
        continue;
      }

      if (parsed.type === "TOOL") {
        const toolName = parsed.tool || "";
        this.streamMessage(context, parsed.message || `Đang thực thi công cụ: ${toolName}...`);
        pendingNextTask = parsed.nextTask;

        let toolResponse = "";
        try {
          toolResponse = await this.executeTool(toolName, parsed.args, context);
        } catch (err: any) {
          if (err.message === "PAUSE_FOR_REQUEST_FIELDS") {
            // Dừng vòng lặp vì Frontend đang đi gom fields và sẽ gọi lại API mới
            return { action: "request_fields_pending" };
          }
          if (err.message === "PAUSE_FOR_QA") {
            // Dừng vòng lặp vì Frontend đang chụp ảnh màn hình
            return { action: "test_request_pending" };
          }
          toolResponse = `Lỗi khi thực thi tool [${toolName}]: ${err.message}`;
        }
        
        messages.push({
          role: "user",
          content: `Kết quả từ Tool [${toolName}]:\n${toolResponse}`
        });
        continue;
      }

      // Nếu không parse được gì, trả về raw
      return rawResponse;
    }

    return "Lỗi: Vượt quá số bước tối đa cho phép của Agent.";
  }
}
