import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// §5.2: sản phẩm thuộc nhóm "nội dung + sản phẩm" của manager — role "edit" KHÔNG được đụng vào
// (khác Post, nơi edit tạo/sửa được bài nháp). price/salePrice/stock/leadbaseStatus là read-only
// từ phía website — chỉ LeadBase mới sửa được (qua routes/public/productsSync.ts, §4.2).
const updateContentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
});

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/products", { preHandler: requireRole("manager") }, async () => {
    const products = await prisma.productCache.findMany({ orderBy: { syncedAt: "desc" } });
    return { products };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/api/products/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }
      return { product };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/api/products/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = updateContentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: parsed.data,
      });

      return { product: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/products/:id/publish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: { publishStatus: "published" },
      });

      return { product: updated };
    },
  );
}
