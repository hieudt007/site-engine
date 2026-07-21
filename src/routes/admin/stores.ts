import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

const storeSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  province: z.string().optional(),
  phone: z.string().optional(),
  enabled: z.boolean().optional(),
});

// Cua hang cho khach chon nhan tai cho (fulfillmentMethod='pickup') - cung nhom quyen thuong mai
// voi products/orders (requireRole("manager")).
export async function registerStoreRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/stores", { preHandler: requireRole("manager") }, async () => {
    const stores = await prisma.store.findMany({ orderBy: { name: "asc" } });
    return { stores };
  });

  app.post("/admin/api/stores", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = storeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const store = await prisma.store.create({ data: parsed.data });
    return reply.code(201).send({ store });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/stores/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = storeSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const store = await prisma.store.update({ where: { id: request.params.id }, data: parsed.data });
      return { store };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/stores/:id",
    { preHandler: requireRole("manager") },
    async (request) => {
      await prisma.store.delete({ where: { id: request.params.id } });
      return { success: true };
    },
  );
}
