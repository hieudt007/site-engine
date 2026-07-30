import cron from "node-cron";
import { prisma } from "../db.js";
import { AgentFactory } from "../agents/core/AgentFactory.js";
import type { AgentContext } from "../agents/core/BaseAgent.js";
import { AutomationRegistry } from "../jobs/AutomationRegistry.js";

// Worker chay dung hen cac ban ghi Automation (mau publishScheduler.ts) - quet moi phut, luon chay
// qua agent "automation" (key co dinh, allowedTools/allowedAgents bi gioi han chat che - xem
// seedAgents.ts + comment tren model Automation trong schema.prisma) vi day la hanh dong TU DONG,
// KHONG AI GIAM SAT luc chay.
export function startAutomationScheduler(): void {
  cron.schedule("* * * * *", () => {
    runDueAutomations().catch((err) => console.error("automationScheduler: lỗi không mong đợi", err));
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
        const agentKey = item.aiAgentId || "automation"; // fallback to automation
        let agent;
        try {
           agent = await AgentFactory.create(agentKey);
        } catch {
           agent = await AgentFactory.create("automation"); // try fallback if db ID doesn't exist
        }
        if (!agent) {
          throw new Error(`Agent "${agentKey}" không tồn tại hoặc đang tắt.`);
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
