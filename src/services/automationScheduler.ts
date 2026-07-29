import cron from "node-cron";
import { prisma } from "../db.js";
import { AgentFactory } from "../agents/core/AgentFactory.js";
import type { AgentContext } from "../agents/core/BaseAgent.js";

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

  const agent = await AgentFactory.create("automation");
  if (!agent) {
    console.error("automationScheduler: agent key=\"automation\" không tồn tại hoặc đang tắt.");
    return;
  }

  for (const item of due) {
    // Danh dau "running" NGAY de lan quet tiep theo (1 phut sau) khong chay trung neu luot nay
    // chua xong (vd AI lap nhieu buoc, chay lau hon 1 phut).
    await prisma.automation.update({ where: { id: item.id }, data: { status: "running" } });

    try {
      const context: AgentContext = {
        meta: { userId: item.createdBy ?? undefined },
        history: [],
        // Khong co "reply" - day la job nen (khong phai request HTTP dang cho), moi loi goi
        // streamTypingStart/streamNarration/streamToolCall trong BaseAgent deu tu no-op an toan.
      };
      const result = await agent.run(context, item.prompt);
      const resultText = typeof result === "string" ? result : (result as any).message || JSON.stringify(result);

      if (item.recurrence === "daily") {
        const next = new Date(item.scheduledAt);
        next.setDate(next.getDate() + 1);
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
