import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { listShippingRules } from "../../services/shipping.js";

const shippingRuleSchema = z.object({
  name: z.string().min(1),
  provinces: z.array(z.string().min(1)),
  baseFee: z.number().int().nonnegative(),
  freeShipThreshold: z.number().int().nonnegative().nullable().optional(),
  enabled: z.boolean().optional(),
});

// Cung nhom quyen thuong mai voi products/orders (requireRole("manager")) - khac payment-methods
// (chi admin, vi dung tai khoan ngan hang/API secret gateway thuc su nhay cam hon).
export async function registerShippingRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/shipping-rules", { preHandler: requireRole("manager") }, async () => {
    const rules = await listShippingRules();
    return { rules };
  });

  app.post("/admin/api/shipping-rules", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = shippingRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const rule = await prisma.shippingRule.create({
      data: {
        name: parsed.data.name,
        provinces: parsed.data.provinces,
        baseFee: parsed.data.baseFee,
        freeShipThreshold: parsed.data.freeShipThreshold ?? null,
        enabled: parsed.data.enabled ?? true,
      },
    });
    return reply.code(201).send({ rule });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/shipping-rules/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = shippingRuleSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const rule = await prisma.shippingRule.update({
        where: { id: request.params.id },
        data: {
          ...parsed.data,
          ...(parsed.data.freeShipThreshold !== undefined ? { freeShipThreshold: parsed.data.freeShipThreshold } : {}),
        },
      });
      return { rule };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/shipping-rules/:id",
    { preHandler: requireRole("manager") },
    async (request) => {
      await prisma.shippingRule.delete({ where: { id: request.params.id } });
      return { success: true };
    },
  );
}
