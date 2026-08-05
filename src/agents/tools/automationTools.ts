import { MCPTool } from "../core/ToolRegistry.js";
import { prisma } from "../../db.js";

// 4 tool de agent "assistant" TU QUAN LY lich tu dong (tao/sua/xoa/liet ke ban ghi trong bang
// Automation) - truoc day tach rieng 1 agent "automation" cho viec nay, da gop chung vao
// "assistant" (xem seedAgents.ts). CHI thao tac tren du lieu "khi nao chay + prompt gi", KHONG tu
// thuc thi gi ca (viec chay that do services/automationScheduler.ts - worker cron rieng - dam
// nhan, tu tra ve dung Agent (theo Automation.aiAgentId) de chay prompt da luu). Xem comment tren
// model Automation (schema.prisma) cho ly do vi sao tach biet nghiem ngat nhu vay.

const VALID_RECURRENCE = new Set(["once", "daily"]);

export const createAutomationTool: MCPTool = {
  name: "create_automation",
  description:
    'Schedule this agent to run again later with a saved prompt. {"name": "short label", "prompt": "full instructions for the future run", "scheduledAt": "ISO datetime, e.g. 2026-07-29T08:00:00", "recurrence": "once"|"daily"|"{number} minute"|"{number} hour"|"{number} day" (optional, default "once")}',
  execute: async (args, context) => {
    const name = String(args.name || "").trim();
    const prompt = String(args.prompt || "").trim();
    const scheduledAtRaw = String(args.scheduledAt || "").trim();
    const recurrence = String(args.recurrence || "once").trim();

    if (!name) return "Error: missing name.";
    if (!prompt) return "Error: missing prompt.";
    if (!scheduledAtRaw) return "Error: missing scheduledAt (ISO datetime).";
    const scheduledAt = new Date(scheduledAtRaw);
    if (Number.isNaN(scheduledAt.getTime())) return "Error: invalid scheduledAt, use ISO datetime format.";
    if (!VALID_RECURRENCE.has(recurrence) && !/^\d+ (minute|hour|day)$/.test(recurrence)) {
      return `Error: recurrence must be one of: ${[...VALID_RECURRENCE].join(", ")} or format like "5 minute", "2 hour".`;
    }

    const userId = context.meta?.userId ? Number(context.meta.userId) : null;
    const automation = await prisma.automation.create({
      data: { name, prompt, scheduledAt, recurrence, createdBy: userId },
    });
    return `Automation created: id=${automation.id}, will run at ${automation.scheduledAt.toISOString()} (${recurrence}).`;
  },
};

export const updateAutomationTool: MCPTool = {
  name: "update_automation",
  description:
    'Edit an existing automation (only pass fields you want to change). {"id": "automation_id", "name"?: "...", "prompt"?: "...", "scheduledAt"?: "ISO datetime", "recurrence"?: "once"|"daily"|"{number} minute", "status"?: "pending"|"cancelled"}',
  execute: async (args, _context) => {
    const id = String(args.id || "").trim();
    if (!id) return "Error: missing id.";
    const existing = await prisma.automation.findUnique({ where: { id } });
    if (!existing) return `Error: automation [${id}] not found.`;

    const data: Record<string, any> = {};
    if (typeof args.name === "string" && args.name.trim()) data.name = args.name.trim();
    if (typeof args.prompt === "string" && args.prompt.trim()) data.prompt = args.prompt.trim();
    if (typeof args.scheduledAt === "string" && args.scheduledAt.trim()) {
      const d = new Date(args.scheduledAt);
      if (Number.isNaN(d.getTime())) return "Error: invalid scheduledAt, use ISO datetime format.";
      data.scheduledAt = d;
    }
    if (typeof args.recurrence === "string") {
      if (!VALID_RECURRENCE.has(args.recurrence) && !/^\d+ (minute|hour|day)$/.test(args.recurrence)) {
        return `Error: recurrence must be one of: ${[...VALID_RECURRENCE].join(", ")} or format like "5 minute".`;
      }
      data.recurrence = args.recurrence;
    }
    if (typeof args.status === "string") {
      if (!["pending", "cancelled"].includes(args.status)) return 'Error: status can only be set to "pending" or "cancelled" here.';
      data.status = args.status;
    }
    if (Object.keys(data).length === 0) return "Error: nothing to update.";

    await prisma.automation.update({ where: { id }, data });
    return `Automation [${id}] updated.`;
  },
};

export const deleteAutomationTool: MCPTool = {
  name: "delete_automation",
  description: 'Delete a scheduled automation permanently. {"id": "automation_id"}',
  execute: async (args) => {
    const id = String(args.id || "").trim();
    if (!id) return "Error: missing id.";
    const existing = await prisma.automation.findUnique({ where: { id } });
    if (!existing) return `Error: automation [${id}] not found.`;
    await prisma.automation.delete({ where: { id } });
    return `Automation [${id}] deleted.`;
  },
};

export const listAutomationsTool: MCPTool = {
  name: "list_automations",
  description: "List scheduled automations (most recent first). Empty args.",
  execute: async () => {
    const rows = await prisma.automation.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    if (rows.length === 0) return "(No automations scheduled.)";
    return rows
      .map((r) => `id=${r.id} | ${r.name} | ${r.status} | ${r.recurrence} | next: ${r.scheduledAt.toISOString()}${r.result ? ` | last result: ${r.result.slice(0, 200)}` : ""}`)
      .join("\n");
  },
};
