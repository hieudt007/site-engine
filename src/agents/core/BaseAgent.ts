import type { Agent } from "@prisma/client";
import { prisma } from "../../db.js";
import { callAgentConversation, ConversationTurn } from "./aiClient.js";
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
  // Chuoi tuy bien do NGUOI GOI (aiChat.ts/customerChat.ts/...) tu dung sao cho phu hop voi luong
  // cua no (vd "[Trang hiện tại] X", "FIELDS LIST", context kenh/khach hang...) - BaseAgent KHONG
  // biet/khong can biet ben trong co gi, chi noi vao system prompt MOI VONG cua run() nay (system
  // prompt la truong doc lap, provider KHONG tu nho lai tu vong truoc - bo di se mat ngu canh ngay
  // tu vong 2). Tach rieng khoi SKILL LIST/SUB AGENT (BaseAgent tu quan ly, tinh 1 lan vi la danh
  // muc tool - khac ban chat voi boi canh dong nay) - xem thao luan thiet ke.
  extraSystemPrompt?: string;
  // Runtime tools are added by use_skill for this run only. They are not persisted back to the
  // caller agent; the skill row stays the source of truth.
  runtimeAllowedTools?: string[];
  usedSkillKeys?: string[];
}

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

  // Bao hieu "AI da bat dau xu ly" NGAY KHI nhan byte dau tien tu provider (truoc khi co ket qua
  // that) - dung lam typing indicator o frontend, thay cho viec phai doi ca cuc JSON hoan chinh moi
  // biet AI dang lam gi. Chi bat len duoc khi settings.stream=true (Agent.settings) (xem callAgentConversation).
  protected streamTypingStart(context: AgentContext): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "typing_start" })}\n\n`);
    } catch { }
  }

  // Doan MOI cua "message" ngay khi provider tra ve (xem aiClient.ts: extractPartialMessage()) -
  // frontend nen tu GOP DAN (khong thay the) de co hieu ung go chu that. Reset ve chuoi rong o phia
  // frontend moi khi "typing_start" ban len (danh dau bat dau 1 luot goi AI MOI trong vong lap).
  protected streamMessageDelta(context: AgentContext, delta: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "message_delta", text: delta })}\n\n`);
    } catch { }
  }

  // Stream "message" AI viet KEM tool_calls (narration tam thoi, vd "de em kiem tra mot chut") -
  // CHI de hien thi real-time cho nguoi dang xem (admin qua LiveChat/AI Chat), KHONG phai cau tra
  // loi cuoi cung nen KHONG ghi vao lich su/DB - mat la thoi, khong can luu lai (xem thao luan thiet
  // ke: chi message cuoi cung - luc khong con tool_calls - moi duoc ghi log ben goi run()).
  protected streamNarration(context: AgentContext, narration: string): void {
    if (!context.reply) return;
    try {
      context.reply.raw.write(`data: ${JSON.stringify({ step: "narration", label: narration })}\n\n`);
    } catch { }
  }

  // KHONG con nhan "context" - phan boi canh rieng cua tung luong (trang hien tai, FIELDS LIST...)
  // da chuyen thanh trach nhiem cua NGUOI GOI tu dung context.extraSystemPrompt (xem AgentContext).
  // BaseAgent chi con lo phan CHUNG: system prompt goc + danh muc Skill/Sub Agent (can moi vong vi
  // la thu AI co the goi, khong phai boi canh tinh).
  protected async getSystemPrompt(): Promise<string> {
    let prompt = this.agentModel.systemPrompt || "";

    // KHONG con nhet "AVAILABLE TOOLS" bang text vao prompt nua - tool duoc khai bao THAT qua tham
    // so "tools" native cua API (xem ToolRegistry.getOpenAiToolDefs(), aiClient.ts/callAgentConversation()),
    // provider tu biet AI co the goi gi, khong can lap lai trong system prompt.

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

    const subAgentKeys = this.agentModel.allowedAgents || [];
    if (subAgentKeys.length > 0) {
      const subAgents = await prisma.agent.findMany({
        where: { type: "agent", isActive: true, key: { in: subAgentKeys } },
      });
      if (subAgents.length > 0) {
        prompt += "\n\nSUB AGENT:\n";
        subAgents.forEach((a) => {
          prompt += `- \`${a.key}\`: ${a.name}`;
        });
      }
    }
    return prompt;
  }

  protected async executeSpecificTool(toolName: string, _args: Record<string, any>, _context: AgentContext): Promise<string> {
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

  protected effectiveAllowedTools(context: AgentContext): string[] {
    return Array.from(new Set([...(this.agentModel.allowedTools || []), ...(context.runtimeAllowedTools || [])]));
  }

  public async run(context: AgentContext, message: string, imageUrl?: string): Promise<string | object> {
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

    // Khởi tạo mảng tin nhắn - BOM SAN context.history (5 luot gan nhat, da duoc caller - aiChat.ts/
    // customerChat.ts - lam sach + tach tool_calls/tool_result thanh turn rieng truoc khi truyen vao)
    // vao dau "messages" NGAY TU DAU, khong doi AI tu goi get_chat_history moi thay. Tool
    // get_chat_history (assistantTools.ts) van con de AI tu tra cuu THEM khi can xa hon 5 luot mac
    // dinh nay. Dung CHUNG hanh vi cho MOI luong (admin, CSKH...) - khong tach rieng.
    const messages: ConversationTurn[] = context.history.map((h) => ({
      role: h.role,
      // h.content == null (turn assistant chi goi tool, khong co narration) PHAI GIU NGUYEN null -
      // JSON.stringify(null) tra ve CHUOI "null" (4 ky tu), KHONG phai gia tri null that, se bi hieu
      // nham la AI thuc su noi chu "null" (da gap bug nay 1 lan, xem lich su session).
      content: h.content == null ? null : typeof h.content === "string" ? h.content : JSON.stringify(h.content),
      toolCallId: h.toolCallId,
      toolCalls: h.toolCalls,
    }));
    // Trace CAC TOOL DA GOI + KET QUA cua LUOT NAY (KHONG gom narration - loi noi tam thoi, khong
    // phai du lieu can nho) - khac han "messages" o tren (chi song trong 1 lan run(), khong luu DB).
    // Dinh kem vao ket qua REPLY cuoi cung de aiChat.ts ghi vao AdminChatHistory.metadata, phuc vu
    // doc lai qua get_chat_history o cac luot SAU (xem thao luan thiet ke: luu qua trinh goi tool +
    // ket qua + cau tra loi cuoi, khong phai toan bo moi thu). Cat ngan result tranh phinh DB/token.
    // round = loopCount cua vong goi AI sinh ra tool call nay - de caller (aiChat.ts/customerChat.ts)
    // GOM LAI dung nhom khi build lai history: nhieu tool cung "round" nghia la AI goi CUNG 1 luot
    // (1 turn assistant chua nhieu phan tu tool_calls), khac han nhieu round rieng le (nhieu turn
    // assistant lien tiep, moi turn 1 tool) - giu dung hinh dang that su da xay ra trong luc chay.
    const trace: { id: string; tool: string; args: Record<string, any>; result: string; round: number }[] = [];
    const TRACE_RESULT_MAX_LEN = 500;
    let finalMessage = message;
    if (context.meta.toolData) {
      finalMessage += `\n\n--- Current form data ---\n${JSON.stringify(context.meta.toolData, null, 2)}`;
    }

    // Danh dau TIN HIEN TAI (dau tien cua run() nay) bang 1 marker ngan - phan biet ro voi cac turn
    // "user" KHAC trong history (turn cu, hoac turn tool-result) trong deu cung shape/role, AI kho
    // biet dau la yeu cau MOI can xu ly tu dau. Yeu cau cu the AI phai lam gi voi marker nay (vd co
    // bat buoc "message" o vong dau khi can nhieu buoc hay khong) do TUNG agent tu dinh nghia rieng
    // trong systemPrompt cua no (cac agent phuc vu doi tuong khac nhau, khong ap dung chung 1 rule
    // duoc) - o day chi bao HIEU, khong ra lenh gi ca.
    messages.push({
      role: "user",
      content: `[NEW REQUEST]\n${finalMessage}`,
      imageUrl: imageUrl
    });

    // System prompt goc (+ SKILL/SUB AGENT list) tinh 1 LAN DUY NHAT truoc vong lap - khong doi
    // giua cac vong cua CUNG 1 run() nay, tranh query DB lai (skill/sub-agent list) moi vong tool-loop.
    const baseSystemPrompt = await this.getSystemPrompt();

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

      // extraSystemPrompt (boi canh rieng cua nguoi goi) gui kem o MOI vong - vong sau (tool-loop
      // tiep tuc) van can thay lai channel/khach hang/... vi system prompt la truong doc lap gui LAI
      // TU DAU moi lan goi API (khong ke thua tu vong truoc), thieu se mat ngu canh tu vong 2 tro di.
      const systemPrompt = context.extraSystemPrompt ? `${baseSystemPrompt}\n\n${context.extraSystemPrompt}` : baseSystemPrompt;

      // Native tool-calling qua 9Router (provider tu dam bao cau truc tool_calls dung, khong con
      // phu thuoc AI tu viet dung JSON trong text nua - xem thao luan thiet ke: MarkdownParser/
      // RESPONSE_FORMAT_GUIDE cu da bo hoan toan).
      const allowedToolNames = this.effectiveAllowedTools(context);
      const toolDefs = ToolRegistry.getOpenAiToolDefs(allowedToolNames);
      const result = await callAgentConversation(
        this.agentModel,
        systemPrompt,
        messages,
        toolDefs,
        () => this.streamTypingStart(context),
        (delta) => this.streamMessageDelta(context, delta)
      );

      // Echo lai DUNG turn assistant provider vua tra ve (content that + tool_calls that kem id
      // that provider cap) - khong con tu chep lai JSON rieng nhu truoc.
      messages.push({
        role: "assistant",
        content: result.content,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      });

      if (result.toolCalls.length === 0) {
        // Khong goi tool nao -> "content" la cau tra loi cuoi cung cua luot nay.
        const finalText = result.content || "";
        return { action: "chat", message: finalText, messages: [finalText], actions: trace };
      }

      // Co tool_calls -> "content" (neu co) la narration tam thoi AI noi truoc/trong luc goi tool,
      // KHONG phai cau tra loi cuoi (vong lap van tiep tuc) - chi stream real-time, khong ghi log/DB.
      if (result.content) {
        this.streamNarration(context, result.content);
      }

      // AI co the goi nhieu tool cung luc (tool_calls co > 1 phan tu) - chay TUAN TU (khong
      // Promise.all, vi tool co the doc/ghi chung context.meta), nhung PHAI tra ve du 1 turn
      // role:"tool" cho MOI tool_call (OpenAI-compatible bat buoc khop du, thieu se loi request
      // sau do).
      for (const call of result.toolCalls) {
        this.streamToolCall(context, call.name);

        let toolResponse = "";
        if (!this.effectiveAllowedTools(context).includes(call.name)) {
          toolResponse = `Tool [${call.name}] is not allowed in this context.`;
        } else {
          try {
            toolResponse = await this.executeTool(call.name, call.args, context);
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
              return typeof r === "string" ? { action: "chat", message: r, messages: [r], actions: trace } : r;
            }
            toolResponse = `Error running tool [${call.name}]: ${err.message}`;
          }
        }

        trace.push({ id: call.id, tool: call.name, args: call.args, result: toolResponse.slice(0, TRACE_RESULT_MAX_LEN), round: loopCount });
        messages.push({ role: "tool", toolCallId: call.id, content: toolResponse });
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
    }

    return "Error: exceeded max steps for this agent.";
  }
}
