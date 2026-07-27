import { prisma } from "../../db.js";
import { AgentContext, DelegatedReply } from "../core/BaseAgent.js";
import { MCPTool } from "../core/ToolRegistry.js";

// Gop AGENT_CALL cu thanh 1 tool binh thuong - giong Claude Code khong phan biet "loai" o tang
// giao thuc (moi thu deu la 1 tool_use), chi khac o CACH THUC THI ben trong execute(). Phai duoc
// gan qua allowedTools (agent-edit.liquid) nhu moi tool khac - khac voi truoc day AGENT_CALL luon
// san co khong can gan, day la thay doi hanh vi CO CHU DICH de dong bo voi co che phan quyen chung.
export const callAgentTool: MCPTool = {
  name: "call_agent",
  description:
    '{"agent": "agent_key", "prompt": "brief request", "mode": "await"|"background" (optional, default "await")}',
  execute: async (args: Record<string, any>, context: AgentContext): Promise<string> => {
    const targetAgent = String(args.agent || "").trim();
    if (!targetAgent) return "Error: missing agent.";

    const { AgentFactory } = await import("../core/AgentFactory.js");
    try {
      const agent = await AgentFactory.create(targetAgent);
      if (!agent) return `Error: Agent [${targetAgent}] not found.`;

      const prompt = String(args.prompt || "");

      let imgUrl: string | undefined = undefined;
      if (context.meta.toolData && context.meta.toolData.screenshot) {
        imgUrl = context.meta.toolData.screenshot;
      }

      // Context RIENG cho agent con - "khoi dong lanh", KHONG ke thua context.history cua agent
      // cha, van giu chung "meta"/"reply" (du lieu request hien tai) - xem ghi chu cu trong
      // BaseAgent.handleAgentCall() da bi xoa khi gop vao day.
      // __childAgent: danh dau de BaseAgent.run() cua agent con KHONG tu dang ky rieng vao
      // runRegistry (chen ngang/steering) - vi meta dung chung 1 object voi cha, 2 tang tranh nhau
      // 1 hang doi injection se loi. Chi run() CAP TREN CUNG (chua co co nay) moi track.
      context.meta.__childAgent = true;
      const childContext: AgentContext = { meta: context.meta, history: [], reply: context.reply };
      const result = await agent.run(childContext, prompt, imgUrl);

      // mode="background": agent cha van await (khong chay tien trinh rieng), nhung KET QUA nay
      // phai la phan hoi cuoi cung cua ca luot - nem DelegatedReply de runLoop() cua agent CHA bat
      // va return thang, khong quay lai goi AI cha "dien giai" lai loi agent con vua noi.
      if (String(args.mode || "await") === "background") {
        throw new DelegatedReply(result);
      }

      return typeof result === "object" ? JSON.stringify(result) : result;
    } catch (e: any) {
      if (e instanceof DelegatedReply) throw e;
      return `Error calling Agent [${targetAgent}]: ${e.message}`;
    }
  },
};

// Gop USE_SKILL cu thanh tool - AI doc noi dung skill roi TU LAM TIEP (khong ban giao, khac han
// call_agent). Kiem tra quyen qua context.agentModel.allowedSkills (da duoc BaseAgent.run() gan
// san context.agentModel = this.agentModel truoc khi vao vong lap).
export const useSkillTool: MCPTool = {
  name: "use_skill",
  description:
    '{"skill": "skill_key"}',
  execute: async (args: Record<string, any>, context: AgentContext): Promise<string> => {
    const skillKey = String(args.skill || "").trim();
    if (!skillKey) return "Error: missing skill.";

    const allowedSkills = context.agentModel?.allowedSkills || [];
    if (!allowedSkills.includes(skillKey)) {
      return `Not allowed to use skill [${skillKey}].`;
    }

    const skill = await prisma.agent.findFirst({ where: { type: "skill", isActive: true, key: skillKey } });
    return skill?.content || `Skill [${skillKey}] not found or has no content.`;
  },
};
