import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { customFieldsSchema } from "../../services/customFields.js";

// Chủ đề bài viết — KHÁC Category: 1 bài chỉ thuộc đúng 1 topic (Post.topicId), không phân cấp,
// không có trang công khai riêng (chỉ dùng lọc/gắn nhãn) — CRUD đơn giản, "manager" quản lý danh
// sách (giống postCategories.ts trước khi có excerpt/body/seo).
const topicSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
});

export async function registerTopicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/topics", { preHandler: requireRole("edit") }, async () => {
    const topics = await prisma.topic.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: { select: { posts: true } }
      }
    });
    return { topics };
  });

  app.post("/admin/api/topics", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = topicSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.topic.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    const topic = await prisma.topic.create({ data: parsed.data });
    return reply.code(201).send({ topic });
  });

  // Chỉ sửa customFields — name/slug đặt lúc tạo, không cần màn sửa riêng (topic đơn giản, xoá
  // tạo lại nếu cần đổi tên).
  app.patch<{ Params: { id: string } }>(
    "/admin/api/topics/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = z.object({ customFields: customFieldsSchema }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const topic = await prisma.topic.findUnique({ where: { id: request.params.id } });
      if (!topic) {
        return reply.code(404).send({ error: "Không tìm thấy chủ đề" });
      }

      const updated = await prisma.topic.update({ where: { id: topic.id }, data: parsed.data });
      return { topic: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/topics/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const topic = await prisma.topic.findUnique({ where: { id: request.params.id } });
      if (!topic) {
        return reply.code(404).send({ error: "Không tìm thấy chủ đề" });
      }

      await prisma.post.updateMany({ where: { topicId: topic.id }, data: { topicId: null } });
      await prisma.topic.delete({ where: { id: topic.id } });

      return { success: true };
    },
  );
}
