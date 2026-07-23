import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { customFieldsSchema } from "../../services/customFields.js";

const TYPE = "product";

const seoSchema = z
  .object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
    keyword: z.string().optional(),
    score: z.number().optional(),
    internalLinks: z.number().optional(),
  })
  .optional();

const faqSchema = z
  .array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    }),
  )
  .optional();

const createCategorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
  type: z.enum(["product", "brand"]),
  parentId: z.string().nullable().optional(),
});

const updateCategorySchema = z.object({
  parentId: z.string().nullable().optional(),
  excerpt: z.string().optional(),
  body: z.string().optional(),
  seo: seoSchema,
  customFields: customFieldsSchema,
  faq: faqSchema,
});

// Danh mục sản phẩm — name/slug do LeadBase sở hữu (đồng bộ qua productsSync.ts), KHÔNG có
// tạo/xoá tay ở đây (lifecycle do LeadBase quyết định, y hệt cách ProductCache không có
// route tạo/xoá tay). CHỈ sửa được excerpt/body/seo — nội dung trang danh mục site tự quản.
export async function registerProductCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/product-categories", { preHandler: requireRole("manager") }, async () => {
    const categories = await prisma.category.findMany({
      where: { type: { in: ["product", "brand"] } },
      orderBy: { name: "asc" },
      include: { parent: { select: { name: true } }, _count: { select: { products: true } } },
    });
    return { categories };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/api/product-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || !["product", "brand"].includes(category.type)) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }
      return { category };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/api/product-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || !["product", "brand"].includes(category.type)) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }

      if (parsed.data.parentId) {
        if (parsed.data.parentId === category.id) {
          return reply.code(422).send({ error: "Danh mục không thể là cha của chính nó" });
        }
        const parent = await prisma.category.findUnique({ where: { id: parsed.data.parentId } });
        if (!parent || parent.type !== category.type) {
          return reply.code(422).send({ error: "Danh mục cha không hợp lệ (phải cùng loại)" });
        }
      }

      const updated = await prisma.category.update({ where: { id: category.id }, data: parsed.data });
      return { category: updated };
    },
  );

  app.post("/admin/api/product-categories", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.category.findUnique({
      where: { type_slug: { type: parsed.data.type, slug: parsed.data.slug } },
    });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    if (parsed.data.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parsed.data.parentId } });
      if (!parent || parent.type !== parsed.data.type) {
        return reply.code(422).send({ error: "Danh mục cha không hợp lệ (phải cùng loại)" });
      }
    }

    const category = await prisma.category.create({ data: parsed.data });
    return reply.code(201).send({ category });
  });

  app.delete<{ Params: { id: string } }>(
    "/admin/api/product-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || !["product", "brand"].includes(category.type)) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }

      await prisma.category.delete({ where: { id: category.id } });
      return { success: true };
    }
  );
}
