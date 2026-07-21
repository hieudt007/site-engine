import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { FULFILLMENT_METHOD_KEYS, listFulfillmentMethods } from "../../services/fulfillment.js";

const updateSchema = z.object({ enabled: z.boolean() });

export async function registerFulfillmentMethodRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/fulfillment-methods", { preHandler: requireRole("manager") }, async () => {
    const methods = await listFulfillmentMethods();
    return { methods };
  });

  app.patch<{ Params: { method: string } }>(
    "/admin/api/fulfillment-methods/:method",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const { method } = request.params;
      if (!FULFILLMENT_METHOD_KEYS.includes(method as (typeof FULFILLMENT_METHOD_KEYS)[number])) {
        return reply.code(404).send({ error: "Hình thức nhận hàng không tồn tại" });
      }
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const updated = await prisma.fulfillmentMethod.upsert({
        where: { method },
        create: { method, enabled: parsed.data.enabled },
        update: { enabled: parsed.data.enabled },
      });
      return { method: updated };
    },
  );
}
