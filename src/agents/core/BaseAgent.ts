import type { Agent } from "@prisma/client";
import { prisma } from "../../db.js";
import { callAgentConversation, ConversationTurn } from "./aiClient.js";
import { MarkdownParser } from "./MarkdownParser.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";
import { ToolRegistry } from "./ToolRegistry.js";
import * as runRegistry from "./runRegistry.js";

// Nem tu call_agent (agentTools.ts) khi mode="background": agent con da chay XONG (agent cha van
// await binh thuong, KHONG phai chay that o tien trinh khac), nhung ket qua cua no PHAI la cau
// tra loi CUOI CUNG luon - khong doc lai cho agent cha "dien giai" them 1 luot AI nua. Bat trong
// runLoop() ngay o catch cua vong goi tool, return thang, bo qua phan con lai cua vong lap.
export class DelegatedReply extends Error {
  constructor(public result: string | object) {
    super("DELEGATED_REPLY");
  }
}

export interface AgentContext {
  meta: Record<string, any>;
  history: ChatHistoryItem[];
  reply?: import("fastify").FastifyReply;
  // Duoc BaseAgent.run() tu dien truoc khi goi tool - cac tool can goi lai AI (vd retryUntilValid)
  // dung field nay thay vi nhan agent rieng qua tham so.
  agentModel?: Agent;
}

// Huong dan dinh dang chung - luon noi vao system prompt cua MOI agent. Nho agent khac xu ly hay
// dung skill deu la TOOL_CALL binh thuong (tool "call_agent"/"use_skill" trong agentTools.ts) -
// khong con la loai rieng, giong Claude Code khong phan biet o tang giao thuc.
const RESPONSE_FORMAT_GUIDE = `=== OUTPUT FORMAT ===

1. End turn:
# REPLY_TO_USER
{"messages": ["message 1", "message 2 (optional, max 2)"], "images": ["url1", "url2",..]}

2. TOOL LIST`;

export class BaseAgent {
  protected agentModel: Agent;
  // So lan lap toi da CUA RIENG agent nay (Agent.maxLoops, cau hinh qua trang tao/sua agent) -
  // KHONG dung chung/cong don voi agent cha hay agent con no goi qua tool call_agent, vi moi lan
  // agent.run() la 1 vong lap doc lap voi loopCount rieng (xem run()).
  protected maxSteps: number;

  constructor(model: Agent) {
    this.agentModel = model;
    this.maxSteps = model.maxLoops || 10;
  }

  public getAgentModel(): Agent {
    return this.agentModel;
  }

  // Stream ten tool NGAY TRUOC KHI thuc thi - frontend thay dong "dang suy nghi" bang dong nay.
  // KHONG dua args len frontend - args co the chua du lieu nhay cam (vd prompt noi bo, thong tin
  // khach hang) khong nen phoi cho nguoi dung cuoi thay.
  protected streamToolCall(context: AgentContext, toolName: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "tool", label: `Đang gọi ${toolName}` })}\n\n`);
    } catch { }
  }

  protected async getSystemPrompt(context?: AgentContext): Promise<string> {
    let prompt = this.agentModel.systemPrompt || "";

    // "[Trang hiện tại]" chuyen tu finalMessage (aiChat.ts) sang day - dat TRUOC OUTPUT FORMAT,
    // vi day la boi canh on dinh cho ca cuoc hoi thoai (giong system prompt), khong phai noi dung
    // rieng cua tung tin nhan.
    if (context?.meta.pageTitle) {
      prompt += `\n\n[Trang hiện tại] ${context.meta.pageTitle} (${context.meta.pageUrl || ""})`;
    }

    prompt += "\n\n" + RESPONSE_FORMAT_GUIDE;
    // Nối thêm danh sách công cụ từ ToolRegistry
    const toolPrompt = ToolRegistry.formatToolPrompt(this.agentModel.allowedTools || []);
    if (toolPrompt) {
      prompt += "\n" + toolPrompt;
    }

    // FIELDS LIST chuyen tu finalMessage (run()) sang day - dat NGAY SAU danh sach tool, cung ly
    // do nhu tren. CHI hien khi agent nay THAT SU co tool "read_fields" trong allowedTools - neu
    // khong AI se doc thay huong dan goi 1 tool no khong duoc phep dung, vua thua vua gay nham.
    const hasReadFieldsTool = (this.agentModel.allowedTools || []).includes("read_fields");
    if (hasReadFieldsTool && context?.meta.availableFields && Array.isArray(context.meta.availableFields) && context.meta.availableFields.length > 0) {
      prompt += `\n\n--- FIELDS LIST ---\n[${context.meta.availableFields.join(', ')}]\n(Call read_fields to read a field's value)`;
    }

    // Nối thêm danh sách Skill duoc phep dung (Agent.type='skill') - chi hien ten + mo ta ngan
    // (systemPrompt), KHONG hien content day du de do ton token - AI phai goi tool use_skill moi
    // doc duoc noi dung day du.
    const skillKeys = this.agentModel.allowedSkills || [];
    if (skillKeys.length > 0) {
      const skills = await prisma.agent.findMany({
        where: { type: "skill", isActive: true, key: { in: skillKeys } },
      });
      if (skills.length > 0) {
        prompt += "\n\nSKILL LIST:\n";
        skills.forEach((s) => {
          prompt += `- \`${s.key}\`: ${s.systemPrompt || "(no description)"}\n`;
        });
      }
    }
    return prompt;
  }

  protected async executeSpecificTool(toolName: string, args: Record<string, any>, context: AgentContext): Promise<string> {
    return `Error: tool ${toolName} not registered.`;
  }

  protected async executeTool(toolName: string, args: Record<string, any>, context: AgentContext): Promise<string> {
    const tool = ToolRegistry.getTool(toolName);
    if (tool) {
      return tool.execute(args, context);
    }
    // Fallback for legacy tools until fully migrated
    return this.executeSpecificTool(toolName, args, context);
  }

  public async run(context: AgentContext, message: string, imageUrl?: string): Promise<string | object> {
    let loopCount = 0;
    context.agentModel = this.agentModel;

    // Chi track/cho phep "chen ngang" (steering, xem runRegistry.ts) o CAP TREN CUNG - agent con
    // duoc goi qua tool call_agent co context.meta.__childAgent = true (dung chung 1 object meta
    // voi cha) nen se KHONG tu dang ky rieng, tranh 2 tang cung tranh nhau 1 hang doi injection.
    const historyId: number | undefined = typeof context.meta.historyId === "number" ? context.meta.historyId : undefined;
    const trackRun = historyId !== undefined && !context.meta.__childAgent;
    if (trackRun) runRegistry.markRunActive(historyId!);

    try {
      return await this.runLoop(context, message, imageUrl, trackRun ? historyId! : undefined);
    } finally {
      if (trackRun) runRegistry.markRunDone(historyId!);
    }
  }

  private async runLoop(context: AgentContext, message: string, imageUrl: string | undefined, trackedHistoryId: number | undefined): Promise<string | object> {
    let loopCount = 0;

    // Khởi tạo context mảng tin nhắn - lich su chat CU KHONG con tu dong nhet vao nua, tach thanh
    // tool rieng "get_chat_history" (xem src/agents/tools/historyTool.ts) - AI tu goi khi can.
    const messages: ConversationTurn[] = [];
    let finalMessage = message;
    if (context.meta.toolData) {
      finalMessage += `\n\n--- Current form data ---\n${JSON.stringify(context.meta.toolData, null, 2)}`;
    }

    messages.push({
      role: "user",
      content: finalMessage,
      imageUrl: imageUrl
    });

    while (loopCount < this.maxSteps) {
      loopCount++;

      // Chen ngang (steering): neu co tin nhan moi duoc bom vao trong luc dang xu ly (xem
      // routes/admin/aiChat.ts goi runRegistry.injectMessage()), nhet vao NGAY TRUOC lan goi AI
      // ke tiep - AI se doc duoc va tu quyet dinh doi huong hay tiep tuc.
      if (trackedHistoryId !== undefined) {
        const injected = runRegistry.takePendingInjections(trackedHistoryId);
        if (injected) {
          messages.push({ role: "user", content: injected.join("\n") });
        }
      }

      const systemPrompt = await this.getSystemPrompt(context);

      // Gọi AI voi LICH SU DA TURN THAT (moi turn user/assistant 1 message rieng, khong con
      // JSON.stringify() ca mang lich su nhoi vao 1 "userPrompt" duy nhat nhu truoc). NEM LOI thay
      // vi tra ve string (truoc day nuot loi roi tra ve dang string binh thuong, khien caller o
      // tang tren - vd routes/admin/mcpChat.ts - khong phan biet duoc day la loi hay cau tra loi
      // that, ghi nham status "success" vao lich su). Tool call_agent (agentTools.ts) da tu bat
      // exception va doi thanh string nen khong bi anh huong.
      const rawResponse = await callAgentConversation(this.agentModel, systemPrompt, messages, false);

      // Parse cú pháp Markdown Headings (hoặc JSON)
      const parsed = MarkdownParser.parse(rawResponse);

      // Luu lai turn AI vua noi - neu la TOOL_CALL hop le thi nen thanh JSON gon (khop dinh dang
      // voi turn "user" server tra ve ben duoi, deu la du lieu thuan tuy AI doc lai, khong can
      // trinh bay dep dang Markdown heading day du). INVALID/REPLY van giu nguyen rawResponse -
      // INVALID de AI thay dung loi cua chinh minh ma tu sua, REPLY thi vong lap ket thuc ngay
      // nen khong anh huong.
      const assistantEcho = parsed.type === "TOOL" && parsed.calls
        ? JSON.stringify({ calls: parsed.calls.map((c) => ({ name: c.tool, args: c.args })) })
        : rawResponse;
      messages.push({ role: "assistant", content: assistantEcho });

      if (parsed.type === "INVALID") {
        // AI viet lan >= 2 loai hanh dong khac nhau cung luc - day loi nguoc lai cho AI tu sua o
        // vong lap tiep theo, KHONG am tham bo qua (xem MarkdownParser.parse()).
        messages.push({ role: "user", content: parsed.content });
        continue;
      }

      if (parsed.type === "REPLY") {
        // Luon tra ve dang object co cau truc (khong con tra "string tron") de caller (vd
        // routes/admin/mcpChat.ts) lay duoc ca "messages" (nhieu bubble rieng biet) lan "images".
        return { action: "chat", message: parsed.content, messages: parsed.messages || [parsed.content], images: parsed.images || [] };
      }

      if (parsed.type === "TOOL") {
        // AI co the viet nhieu khoi TOOL_CALL trong 1 luot (vd 2 tool doc lap de so sanh) - chay
        // TUAN TU tung tool (khong Promise.all, vi tool co the doc/ghi chung context.meta), nhung
        // gop KET QUA CUA CA NHOM ve chung 1 luot xu ly - chi ton 1 lan goi AI sau do de doc het
        // ket qua cung luc, thay vi phai goi AI rieng cho tung tool.
        const calls = parsed.calls && parsed.calls.length > 0
          ? parsed.calls
          : [{ tool: parsed.tool || "", args: parsed.args }];

        for (const call of calls) {
          this.streamToolCall(context, call.tool);

          let toolResponse = "";
          try {
            toolResponse = await this.executeTool(call.tool, call.args, context);
          } catch (err: any) {
            if (err.message === "PAUSE_FOR_REQUEST_FIELDS") {
              // Dừng vòng lặp vì Frontend đang đi gom fields và sẽ gọi lại API mới
              return { action: "request_fields_pending" };
            }
            if (err.message === "PAUSE_FOR_QA") {
              // Dừng vòng lặp vì Frontend đang chụp ảnh màn hình
              return { action: "test_request_pending" };
            }
            if (err instanceof DelegatedReply) {
              // Uy quyen hoan toan cho sub-agent (xem callAgentTool, mode="background") - ket qua
              // cua no la phan hoi CUOI CUNG, khong quay lai vong lap de agent cha noi them.
              const r = err.result;
              return typeof r === "string" ? { action: "chat", message: r, messages: [r], images: [] } : r;
            }
            toolResponse = `Error running tool [${call.tool}]: ${err.message}`;
          }

          messages.push({
            role: "user",
            content: `Tool [${call.tool}] result:\n${toolResponse}`
          });
        }

        // finish_subtask vua chay xong (ghi co vao context.meta) - NEN mang "messages" lai: giu
        // turn dau tien (yeu cau goc cua user o buoc 0) + 1 dong tom tat, xoa het cac turn tool/
        // agent tho da tich luy giua chung. Lam O DAY (khong phai trong tool) vi chi run() moi
        // giu duoc bien "messages" cuc bo.
        if (context.meta.__pendingSubtaskSummary) {
          const summary = context.meta.__pendingSubtaskSummary as string;
          delete context.meta.__pendingSubtaskSummary;
          const firstTurn = messages[0];
          messages.length = 0;
          messages.push(firstTurn, { role: "user", content: `Done: ${summary}` });
        }
        continue;
      }

      // Nếu không parse được gì, trả về raw
      return rawResponse;
    }

    return "Error: exceeded max steps for this agent.";
  }
}
