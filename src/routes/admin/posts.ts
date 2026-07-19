import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { sanitizePostBody } from "../../services/sanitizeHtml.js";

const createPostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
  body: z.string().min(1),
  excerpt: z.string().optional(),
  coverImage: z.string().optional(),
  authorName: z.string().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  ogImage: z.string().optional(),
  noindex: z.boolean().optional(),
  categoryId: z.string().nullable().optional(),
});

const updatePostSchema = createPostSchema.partial();
const PAGE_SIZE = 20;

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Post", entityId, metadata },
  });
}

// CRUD bài viết (system_design.md §5.2): "edit" chỉ tạo/sửa được bài NHÁP (chưa publishedAt),
// không tự xuất bản/xoá; "manager"/"admin" mới publish/xoá được.
export async function registerPostRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string; categoryId?: string } }>(
    "/admin/api/posts",
    { preHandler: requireRole("edit") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const { q, categoryId } = request.query;

      const where = {
        ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
        ...(categoryId ? { categoryId } : {}),
      };

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { author: { select: { name: true } }, category: { select: { name: true } } },
        }),
        prisma.post.count({ where }),
      ]);

      return { posts, total, page, hasNext: skip + posts.length < total, hasPrev: page > 1 };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/posts/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { id: request.params.id },
        include: { category: true },
      });
      if (!post) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }
      return { post };
    },
  );

  app.post("/admin/api/posts", { preHandler: requireRole("edit") }, async (request, reply) => {
    const parsed = createPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const userId = request.session.get("userId")!;
    const existing = await prisma.post.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    const post = await prisma.post.create({
      data: {
        ...parsed.data,
        body: sanitizePostBody(parsed.data.body),
        authorId: userId,
        updatedByUserId: userId,
      },
    });
    await auditLog(userId, "post.create", post.id);

    return reply.code(201).send({ post });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/posts/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const parsed = updatePostSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const role = request.session.get("role");
      if (role === "edit" && post.publishedAt) {
        return reply.code(403).send({ error: "Bài đã xuất bản — chỉ manager/admin được sửa" });
      }

      const slugChanged = !!parsed.data.slug && parsed.data.slug !== post.slug;
      if (slugChanged) {
        const slugTaken = await prisma.post.findUnique({ where: { slug: parsed.data.slug } });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug đã tồn tại" });
        }
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: {
          ...parsed.data,
          ...(parsed.data.body ? { body: sanitizePostBody(parsed.data.body) } : {}),
          updatedByUserId: userId,
        },
      });
      await auditLog(userId, "post.update", post.id);

      // Doi slug -> tu tao redirect URL cu sang moi (system_design.md, tinh nang Redirect) - link
      // cu (da chia se/da SEO) khong bi 404 khi bai viet doi duong dan.
      if (slugChanged) {
        const fromPath = `/blog/${post.slug}`;
        const toPath = `/blog/${updated.slug}`;
        await prisma.redirect.upsert({
          where: { fromPath },
          create: { fromPath, toPath },
          update: { toPath },
        });
      }

      return { post: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/posts/:id/publish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { publishedAt: new Date(), updatedByUserId: userId },
      });
      await auditLog(userId, "post.publish", post.id);

      return { post: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/posts/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      await prisma.post.delete({ where: { id: post.id } });
      await auditLog(userId, "post.delete", post.id, { title: post.title, slug: post.slug });

      return { success: true };
    },
  );
}
