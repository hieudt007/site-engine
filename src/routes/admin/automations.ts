import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// Quan ly ban ghi Automation qua UI that (khong chi qua AI chat) - xem prisma/schema.prisma cho
// ly do model nay chi luu "khi nao chay + prompt gi", KHONG tu chua logic/code moi. Worker thuc thi
// rieng o services/automationScheduler.ts, luon goi agent key="automation" co dinh.
const VALID_RECURRENCE = ["once", "daily"] as const;

const automationSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  scheduledAt: z.coerce.date(),
  recurrence: z.enum(VALID_RECURRENCE).optional().default("once"),
});

const updateAutomationSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  scheduledAt: z.coerce.date().optional(),
  recurrence: z.enum(VALID_RECURRENCE).optional(),
  status: z.enum(["pending", "cancelled"]).optional(),
});

const PAGE_SIZE = 20;

export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string } }>(
    "/admin/api/automations",
    { preHandler: requireRole("manager") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;

      const [automations, total] = await Promise.all([
        prisma.automation.findMany({ orderBy: { createdAt: "desc" }, skip, take: PAGE_SIZE }),
        prisma.automation.count(),
      ]);

      return { automations, total, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), hasNext: skip + automations.length < total, hasPrev: page > 1 };
    },
  );

  app.post("/admin/api/automations", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = automationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const userId = request.session.get("userId") as number;
    const automation = await prisma.automation.create({
      data: { ...parsed.data, createdBy: userId },
    });
    return reply.code(201).send({ automation });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/automations/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = updateAutomationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const existing = await prisma.automation.findUnique({ where: { id: request.params.id } });
      if (!existing) {
        return reply.code(404).send({ error: "Không tìm thấy automation" });
      }
      const automation = await prisma.automation.update({ where: { id: existing.id }, data: parsed.data });
      return { automation };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/automations/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const existing = await prisma.automation.findUnique({ where: { id: request.params.id } });
      if (!existing) {
        return reply.code(404).send({ error: "Không tìm thấy automation" });
      }
      await prisma.automation.delete({ where: { id: existing.id } });
      return { success: true };
    },
  );
}
