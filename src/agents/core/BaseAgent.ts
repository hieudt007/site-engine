import type { Agent } from "@prisma/client";
import { prisma } from "../../db.js";
import { callAgentConversation, ConversationTurn } from "./aiClient.js";
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
Mỗi lượt trả lời CHỈ được chứa ĐÚNG MỘT khối dưới đây (không viết gì khác ngoài khối đó). thêm "## next_task"
(tuỳ chọn) để hệ thống tự hiển thị bước kế tiếp.

1. Nhờ Agent khác xử lý:
# AGENT_CALL
## agent
<key_agent>
## payload
### prompt
<yêu cầu cụ thể>

2. Trả lời cuối cùng cho user (không cần làm gì thêm, kết thúc lượt xử lý):
# REPLY_TO_USER
{"messages": ["Tin nhắn 1", "Tin nhắn 2 nếu cần tách riêng"], "images": ["url1", "url2",..]}

3. Gọi công cụ (nếu có công cụ được liệt kê bên dưới) - xem định dạng "TOOL_CALL" ở phần công cụ.

4. Dùng Skill (nếu có Skill được liệt kê bên dưới) - lấy hướng dẫn chi tiết để tự làm, KHÔNG bàn
giao việc cho ai, bạn vẫn là người thực hiện tiếp sau khi đọc xong:
# USE_SKILL
## skill
<skill_key>`;

export class BaseAgent {
  protected agentModel: Agent;
  // So lan lap toi da CUA RIENG agent nay (Agent.maxLoops, cau hinh qua trang tao/sua agent) -
  // KHONG dung chung/cong don voi agent cha hay agent con no goi qua AGENT_CALL, vi moi lan
  // agent.run() la 1 vong lap doc lap voi loopCount rieng (xem run()).
  protected maxSteps: number;

  constructor(model: Agent) {
    this.agentModel = model;
    this.maxSteps = model.maxLoops || 10;
  }

  public getAgentModel(): Agent {
    return this.agentModel;
  }

  // Stream "message" (AI tu giai thich dang lam gi o buoc VUA nhan duoc) ngay lap tuc.
  protected streamMessage(context: AgentContext, message: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "tool", label: message })}\n\n`);
    } catch { }
  }

  // Stream "nextTask" (viec AI du dinh lam o buoc SAU) - goi ngay TRUOC khi goi AI cho buoc tiep
  // theo, khong dung timer co dinh: luc nay tool/agent cua buoc truoc da chay xong nen thoi diem
  // hien thi tu nhien dung luc, khong doan mo timeout.
  protected streamNextTask(context: AgentContext, nextTask: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "next_task", label: nextTask })}\n\n`);
    } catch { }
  }

  protected async getSystemPrompt(context?: AgentContext): Promise<string> {
    let prompt = this.agentModel.systemPrompt || "";
    prompt += "\n\n" + RESPONSE_FORMAT_GUIDE;
    // Nối thêm danh sách công cụ từ ToolRegistry
    const toolPrompt = ToolRegistry.formatToolPrompt(this.agentModel.allowedTools || []);
    if (toolPrompt) {
      prompt += "\n" + toolPrompt;
    }
    // Nối thêm danh sách Skill duoc phep dung (Agent.type='skill') - chi hien ten + mo ta ngan
    // (systemPrompt), KHONG hien content day du de do ton token - AI phai USE_SKILL moi doc duoc.
    const skillKeys = this.agentModel.allowedSkills || [];
    if (skillKeys.length > 0) {
      const skills = await prisma.agent.findMany({
        where: { type: "skill", isActive: true, key: { in: skillKeys } },
      });
      if (skills.length > 0) {
        prompt += "\n\nDANH SÁCH SKILL HỖ TRỢ:\n";
        skills.forEach((s) => {
          prompt += `- \`${s.key}\`: ${s.systemPrompt || "(không có mô tả)"}\n`;
        });
      }
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

      // Context RIENG cho agent con - "khoi dong lanh", KHONG ke thua context.history cua agent
      // cha (truoc day dung chung nguyen context nen agent con vo tinh doc ca lich su chat khong
      // lien quan, ton token) - agent cha PHAI tu viet prompt du ngu canh can thiet cho agent con
      // (giong AGENT_CALL trong RESPONSE_FORMAT_GUIDE da yeu cau "bao gom boi canh day du"). Van
      // giu chung "meta"/"reply" vi do la du lieu request hien tai (pageUrl, toolData, SSE...),
      // khac voi "history" la lich su hoi thoai rieng cua tung agent.
      const childContext: AgentContext = { meta: context.meta, history: [], reply: context.reply };
      const result = await agent.run(childContext, prompt, imgUrl);

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

    // Khởi tạo context mảng tin nhắn - lich su chat CU KHONG con tu dong nhet vao nua, tach thanh
    // tool rieng "get_chat_history" (xem src/agents/tools/historyTool.ts) - AI tu goi khi can.
    const messages: ConversationTurn[] = [];
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

      const systemPrompt = await this.getSystemPrompt(context);

      // Gọi AI voi LICH SU DA TURN THAT (moi turn user/assistant 1 message rieng, khong con
      // JSON.stringify() ca mang lich su nhoi vao 1 "userPrompt" duy nhat nhu truoc). NEM LOI thay
      // vi tra ve string (truoc day nuot loi roi tra ve dang string binh thuong, khien caller o
      // tang tren - vd routes/admin/mcpChat.ts - khong phan biet duoc day la loi hay cau tra loi
      // that, ghi nham status "success" vao lich su). handleAgentCall() o tren da tu bat exception
      // va doi thanh string cho luong AGENT_CALL nen khong bi anh huong.
      const rawResponse = await callAgentConversation(this.agentModel, systemPrompt, messages, false);

      // Lưu lại câu trả lời của AI vào history
      messages.push({
        role: "assistant",
        content: rawResponse
      });

      // Parse cú pháp Markdown Headings (hoặc JSON)
      const parsed = MarkdownParser.parse(rawResponse);

      if (parsed.type === "REPLY") {
        this.streamMessage(context, "Đã có câu trả lời.");
        // Luon tra ve dang object co cau truc (khong con tra "string tron") de caller (vd
        // routes/admin/mcpChat.ts) lay duoc ca "messages" (nhieu bubble rieng biet) lan "images".
        return { action: "chat", message: parsed.content, messages: parsed.messages || [parsed.content], images: parsed.images || [] };
      }

      if (parsed.type === "AGENT") {
        const targetAgent = parsed.tool || "";
        this.streamMessage(context, `Đang bàn giao công việc cho Agent [${targetAgent}]...`);
        pendingNextTask = parsed.nextTask;

        const agentResponse = await this.handleAgentCall(targetAgent, parsed.args, context);

        messages.push({
          role: "user",
          content: `Kết quả từ Agent [${targetAgent}]:\n${agentResponse}`
        });
        continue;
      }

      if (parsed.type === "SKILL") {
        const skillKey = parsed.tool || "";
        this.streamMessage(context, `Đang tra cứu skill [${skillKey}]...`);
        pendingNextTask = parsed.nextTask;

        let skillContent: string;
        if (!(this.agentModel.allowedSkills || []).includes(skillKey)) {
          skillContent = `Bạn không được phép dùng skill [${skillKey}].`;
        } else {
          const skill = await prisma.agent.findFirst({ where: { type: "skill", isActive: true, key: skillKey } });
          skillContent = skill?.content || `Không tìm thấy skill [${skillKey}] hoặc skill chưa có nội dung.`;
        }

        messages.push({
          role: "user",
          content: `Nội dung skill [${skillKey}]:\n${skillContent}`
        });
        continue;
      }

      if (parsed.type === "TOOL") {
        const toolName = parsed.tool || "";
        this.streamMessage(context, `Đang thực thi công cụ: ${toolName}...`);
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
