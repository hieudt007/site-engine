import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { customFieldsSchema } from "../../services/customFields.js";

const TYPE = "post";

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
  parentId: z.string().nullable().optional(),
  faq: faqSchema,
});

const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -").optional(),
  parentId: z.string().nullable().optional(),
  excerpt: z.string().optional(),
  body: z.string().optional(),
  seo: seoSchema,
  customFields: customFieldsSchema,
  faq: faqSchema,
});

// Danh mục bài viết — khái niệm CỦA RIÊNG website, CRUD đầy đủ (khác danh mục sản phẩm,
// productCategories.ts, chỉ sửa được excerpt/body/seo vì name/slug đồng bộ từ LeadBase). Dùng
// CHUNG bảng Category, luôn lọc/set type='post'. Quản lý DANH SÁCH category (tạo/sửa/xoá) cần
// "manager" — nhưng GÁN category cho 1 bài viết cụ thể vẫn qua PATCH /admin/api/posts/:id
// (requireRole("edit")), không ở đây.
export async function registerPostCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/post-categories", { preHandler: requireRole("edit") }, async () => {
    const categories = await prisma.category.findMany({
      where: { type: TYPE },
      orderBy: { name: "asc" },
      include: { 
        parent: { select: { name: true } },
        _count: { select: { posts: true } }
      },
    });
    return { categories };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/api/post-categories/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || category.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }
      return { category };
    },
  );

  app.post("/admin/api/post-categories", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.category.findUnique({
      where: { type_slug: { type: TYPE, slug: parsed.data.slug } },
    });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    if (parsed.data.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parsed.data.parentId } });
      if (!parent || parent.type !== TYPE) {
        return reply.code(422).send({ error: "Danh mục cha không hợp lệ" });
      }
    }

    const category = await prisma.category.create({ data: { ...parsed.data, type: TYPE } });
    return reply.code(201).send({ category });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/post-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || category.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }

      if (parsed.data.slug && parsed.data.slug !== category.slug) {
        const slugTaken = await prisma.category.findUnique({
          where: { type_slug: { type: TYPE, slug: parsed.data.slug } },
        });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug đã tồn tại" });
        }
      }

      if (parsed.data.parentId) {
        if (parsed.data.parentId === category.id) {
          return reply.code(422).send({ error: "Danh mục không thể là cha của chính nó" });
        }
        const parent = await prisma.category.findUnique({ where: { id: parsed.data.parentId } });
        if (!parent || parent.type !== TYPE) {
          return reply.code(422).send({ error: "Danh mục cha không hợp lệ" });
        }
      }

      const updated = await prisma.category.update({ where: { id: category.id }, data: parsed.data });
      return { category: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/post-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const category = await prisma.category.findUnique({ where: { id: request.params.id } });
      if (!category || category.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }

      // Nhiều-nhiều (Post.categories) -> xoá Category tự gỡ khỏi mọi bài đang gắn qua bảng join
      // (cascade), không cần tự dọn tay. Category con (parentId trỏ tới đây) tự về null (ON
      // DELETE SET NULL, xem migration).
      await prisma.category.delete({ where: { id: category.id } });

      return { success: true };
    },
  );
}
