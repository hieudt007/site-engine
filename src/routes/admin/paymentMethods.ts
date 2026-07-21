import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { listPaymentMethods, PAYMENT_METHOD_KEYS } from "../../services/paymentMethods.js";

const bankTransferConfigSchema = z.object({
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountHolder: z.string().optional(),
  branch: z.string().optional(),
  qrImage: z.string().optional(),
});

const vnpayConfigSchema = z.object({
  tmnCode: z.string().optional(),
  hashSecret: z.string().optional(),
  sandbox: z.boolean().optional(),
});

// Cau hinh thanh toan la quyen admin (giong settings.ts) - manager/edit khong duoc dung API nay,
// tranh nhan vien thuong tu doi tai khoan ngan hang/API key gateway.
const updatePaymentMethodSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.union([bankTransferConfigSchema, vnpayConfigSchema]).optional(),
});

export async function registerPaymentMethodRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/payment-methods", { preHandler: requireRole("admin") }, async () => {
    const methods = await listPaymentMethods();
    return { methods };
  });

  app.patch<{ Params: { method: string } }>(
    "/admin/api/payment-methods/:method",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { method } = request.params;
      if (!PAYMENT_METHOD_KEYS.includes(method as (typeof PAYMENT_METHOD_KEYS)[number])) {
        return reply.code(404).send({ error: "Phương thức thanh toán không tồn tại" });
      }

      const parsed = updatePaymentMethodSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const updated = await prisma.paymentMethod.upsert({
        where: { method },
        create: { method, enabled: parsed.data.enabled ?? false, config: parsed.data.config ?? undefined },
        update: {
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.config !== undefined ? { config: parsed.data.config } : {}),
        },
      });

      return { method: updated };
    },
  );
}
