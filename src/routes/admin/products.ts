import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { saveRevision, listRevisions } from "../../services/revisions.js";
import { customFieldsSchema } from "../../services/customFields.js";

// §5.2: sản phẩm thuộc nhóm "nội dung + sản phẩm" của manager — role "edit" KHÔNG được đụng vào
// (khác Post, nơi edit tạo/sửa được bài nháp) — nên không có bước "nộp duyệt" như posts.ts,
// manager đi thẳng draft -> scheduled/published. price/salePrice/stock/leadbaseStatus là
// read-only từ phía website — chỉ LeadBase mới sửa được (qua routes/public/productsSync.ts, §4.2).
const seoSchema = z
  .object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
    keyword: z.string().optional(),
    score: z.number().optional(),
  })
  .optional();

const updateContentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  seo: seoSchema,
  customFields: customFieldsSchema,
});

const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });
const PAGE_SIZE = 20;

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string; categoryId?: string; status?: string } }>(
    "/admin/api/products",
    { preHandler: requireRole("manager") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const { q, categoryId, status } = request.query;

      const where = {
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
        ...(categoryId ? { categories: { some: { id: categoryId } } } : {}),
        ...(status ? { status } : {}),
      };

      const [products, total] = await Promise.all([
        prisma.productCache.findMany({
          where,
          orderBy: { syncedAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { categories: { select: { name: true } } },
        }),
        prisma.productCache.count({ where }),
      ]);

      return { products, total, page, hasNext: skip + products.length < total, hasPrev: page > 1 };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/products/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({
        where: { id: request.params.id },
        include: { variants: { orderBy: { syncedAt: "asc" } } },
      });
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

      const userId = request.session.get("userId") ?? null;
      await saveRevision(
        "Product",
        product.id,
        {
          name: product.name,
          description: product.description,
          imageUrls: product.imageUrls,
          seo: product.seo,
          customFields: product.customFields,
        },
        userId,
      );

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: parsed.data,
      });

      return { product: updated };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/products/:id/revisions",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }
      const revisions = await listRevisions("Product", product.id);
      return { revisions };
    },
  );

  app.post<{ Params: { id: string; revisionId: string } }>(
    "/admin/api/products/:id/revisions/:revisionId/restore",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const revision = await prisma.revision.findUnique({ where: { id: request.params.revisionId } });
      if (!revision || revision.entityType !== "Product" || revision.entityId !== product.id) {
        return reply.code(404).send({ error: "Không tìm thấy bản ghi lịch sử" });
      }

      const userId = request.session.get("userId") ?? null;
      await saveRevision(
        "Product",
        product.id,
        {
          name: product.name,
          description: product.description,
          imageUrls: product.imageUrls,
          seo: product.seo,
          customFields: product.customFields,
        },
        userId,
      );

      const snapshot = revision.data as {
        name: string;
        description: string | null;
        imageUrls: string[];
        seo: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        customFields: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      };

      const updated = await prisma.productCache.update({ where: { id: product.id }, data: snapshot });

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
        data: { status: "published", publishedAt: new Date(), scheduledAt: null },
      });

      return { product: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/products/:id/schedule",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = scheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const scheduledAt = new Date(parsed.data.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        return reply.code(422).send({ error: "Thời điểm lên lịch phải ở tương lai" });
      }

      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: { status: "scheduled", scheduledAt, publishedAt: null },
      });

      return { product: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/products/:id/unpublish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: { status: "draft", publishedAt: null, scheduledAt: null },
      });

      return { product: updated };
    },
  );
}
