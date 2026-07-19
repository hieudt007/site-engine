import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// Danh mục bài viết — khái niệm CỦA RIÊNG website, CRUD đầy đủ (khác category sản phẩm, chỉ
// đọc từ LeadBase). Quản lý DANH SÁCH category (tạo/sửa/xoá) cần "manager" — nhưng GÁN category
// cho 1 bài viết cụ thể vẫn qua PATCH /admin/api/posts/:id (requireRole("edit")), không ở đây.
const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
});

export async function registerPostCategoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/post-categories", { preHandler: requireRole("edit") }, async () => {
    const categories = await prisma.postCategory.findMany({ orderBy: { name: "asc" } });
    return { categories };
  });

  app.post("/admin/api/post-categories", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = categorySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.postCategory.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    const category = await prisma.postCategory.create({ data: parsed.data });
    return reply.code(201).send({ category });
  });

  app.delete<{ Params: { id: string } }>(
    "/admin/api/post-categories/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const category = await prisma.postCategory.findUnique({ where: { id: request.params.id } });
      if (!category) {
        return reply.code(404).send({ error: "Không tìm thấy danh mục" });
      }

      // Bài viết đang gán category này -> gỡ về null thay vì chặn xoá (FK đã set không cascade
      // xoá Post, chỉ cần tự gỡ tay categoryId trước khi xoá category).
      await prisma.post.updateMany({ where: { categoryId: category.id }, data: { categoryId: null } });
      await prisma.postCategory.delete({ where: { id: category.id } });

      return { success: true };
    },
  );
}
