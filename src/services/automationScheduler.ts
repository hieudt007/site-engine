import cron from "node-cron";
import { prisma } from "../db.js";
import { AgentFactory } from "../agents/core/AgentFactory.js";
import type { AgentContext } from "../agents/core/BaseAgent.js";
import { AutomationRegistry } from "../jobs/AutomationRegistry.js";
import { logger } from "../logger.js";

// Worker chay dung hen cac ban ghi Automation (mau publishScheduler.ts) - quet moi phut. Chay dung
// AGENT MA ADMIN DA CHON trong dropdown "Chon AI Agent" luc tao lich (Automation.aiAgentId, FK toi
// Agent.id - xem schema.prisma), giong dung mo hinh lead-base-node (jobs/automationWorker.ts). Moi
// agent tu gioi han allowedTools/allowedAgents rieng cua no (seedAgents.ts) - day van la hanh dong
// TU DONG KHONG AI GIAM SAT luc chay, nhung gioi han quyen nam o TUNG agent duoc chon, khong phai o
// viec ep cung 1 agent "automation" cho moi lich (da tung la bug: aiAgentId truyen thang vao
// AgentFactory.create() von tra cuu theo "key" chu khong phai id, nen luon fallback am tham ve
// agent "automation" bat ke admin chon gi - xem runDueAutomations() ben duoi).
export function startAutomationScheduler(): void {
  cron.schedule("* * * * *", () => {
    runDueAutomations().catch((err) => logger.error(err, "automationScheduler: lỗi không mong đợi"));
  });
}

export async function runDueAutomations(): Promise<void> {
  const due = await prisma.automation.findMany({
    where: { status: "pending", scheduledAt: { lte: new Date() } },
  });
  if (due.length === 0) return;

  for (const item of due) {
    await prisma.automation.update({ where: { id: item.id }, data: { status: "running" } });

    try {
      let resultText = "";
      if (item.actionType === "function") {
        const fnName = item.targetFunction || "";
        const fn = AutomationRegistry[fnName];
        if (!fn) {
          throw new Error(`Target function "${fnName}" not found in registry`);
        }
        const fnResult = await fn();
        resultText = fnResult || `Function ${fnName} executed successfully`;
      } else {
        // BUG that da gap: Automation.aiAgentId luu ID that cua Agent (cuid, dung khi admin chon
        // trong dropdown "Chon AI Agent" o UI - xem automations.liquid), nhung AgentFactory.create()
        // tra cuu theo "key" (vd "automation", "content_writer"), KHONG PHAI theo id. Truyen thang
        // aiAgentId vao create() gan nhu khong bao gio khop, roi am tham fallback ve agent
        // "automation" MOI LAN - admin chon agent nao trong UI cung vo nghia, luon chay dung 1
        // agent hardcode. Phai tra ra Agent record TRUOC (theo id) de lay dung "key" cua no, giong
        // dung pattern cua lead-base-node (jobs/automationWorker.ts: tra record theo id, lay
        // agent_key, roi moi goi AgentFactory.create(agent_key)) - khong con fallback am tham nua,
        // bao loi ro rang de admin biet ma sua lai lich thay vi tuong nham dang chay dung agent da chon.
        if (!item.aiAgentId) {
          throw new Error("Chưa chọn AI Agent cho automation này.");
        }
        const agentRecord = await prisma.agent.findUnique({ where: { id: item.aiAgentId } });
        if (!agentRecord || !agentRecord.key) {
          throw new Error(`AI Agent (ID ${item.aiAgentId}) không tồn tại hoặc thiếu key.`);
        }
        const agent = await AgentFactory.create(agentRecord.key);
        if (!agent) {
          throw new Error(`Agent "${agentRecord.key}" không tồn tại hoặc đang tắt.`);
        }
        const context: AgentContext = {
          meta: { userId: item.createdBy ?? undefined },
          history: [],
        };
        const result = await agent.run(context, item.prompt || "");
        resultText = typeof result === "string" ? result : (result as any).message || JSON.stringify(result);
      }

      if (item.recurrence !== "once") {
        const next = new Date(item.scheduledAt);
        if (item.recurrence.includes(" ")) {
          const [intervalStr, type] = item.recurrence.split(" ");
          const interval = parseInt(intervalStr, 10) || 1;
          if (type === "minute") next.setMinutes(next.getMinutes() + interval);
          else if (type === "hour") next.setHours(next.getHours() + interval);
          else if (type === "day") next.setDate(next.getDate() + interval);
        } else {
          switch (item.recurrence) {
            case "every_15_minutes":
              next.setMinutes(next.getMinutes() + 15);
              break;
            case "every_30_minutes":
              next.setMinutes(next.getMinutes() + 30);
              break;
            case "hourly":
              next.setHours(next.getHours() + 1);
              break;
            case "daily":
              next.setDate(next.getDate() + 1);
              break;
            case "weekly":
              next.setDate(next.getDate() + 7);
              break;
            case "monthly":
              next.setMonth(next.getMonth() + 1);
              break;
          }
        }
        await prisma.automation.update({
          where: { id: item.id },
          data: { status: "pending", result: resultText, scheduledAt: next },
        });
      } else {
        await prisma.automation.update({
          where: { id: item.id },
          data: { status: "done", result: resultText },
        });
      }
    } catch (err: any) {
      await prisma.automation.update({
        where: { id: item.id },
        data: { status: "error", result: `Error: ${err.message}` },
      });
    }
  }
}
