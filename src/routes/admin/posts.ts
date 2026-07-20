import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { Role, requireRole } from "../../plugins/requireRole.js";
import { sanitizePostBody } from "../../services/sanitizeHtml.js";
import { canEditContentFields } from "../../services/contentStatus.js";
import { saveRevision, listRevisions } from "../../services/revisions.js";

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

const createPostSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
  body: z.string().min(1),
  excerpt: z.string().optional(),
  coverImage: z.string().optional(),
  categoryIds: z.array(z.string()).optional(), // nhiều-nhiều, xem Category.type='post'
  topicId: z.string().nullable().optional(), // 1-1, xem model Topic
  password: z.string().nullable().optional(), // rỗng/null = bài mở tự do, xem routes/public/blog.ts
  seo: seoSchema,
});

const updatePostSchema = createPostSchema.partial();
const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });
const PAGE_SIZE = 20;

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Post", entityId, metadata },
  });
}

// CRUD bài viết + luồng duyệt 4 trạng thái (draft/pending_review/scheduled/published, xem
// services/contentStatus.ts): "edit" soạn/nộp duyệt (draft <-> pending_review), "manager"/"admin"
// mới lên lịch/xuất bản/gỡ/xoá được. Bảng Post GỘP CHUNG với trang tĩnh, phân biệt bằng
// type='post' (routes/admin/pages.ts dùng type='page' trên CÙNG bảng) — mọi query ở đây LUÔN
// lọc/set type='post' để không bao giờ lộ/động vào trang tĩnh.
export async function registerPostRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string; categoryId?: string; status?: string } }>(
    "/admin/api/posts",
    { preHandler: requireRole("edit") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const { q, categoryId, status } = request.query;

      const where = {
        type: TYPE,
        ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
        ...(categoryId ? { categories: { some: { id: categoryId } } } : {}),
        ...(status ? { status } : {}),
      };

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: {
            author: { select: { name: true } },
            categories: { select: { name: true } },
            topic: { select: { name: true } },
          },
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
        include: { categories: true, topic: true },
      });
      if (!post || post.type !== TYPE) {
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
    const existing = await prisma.post.findUnique({
      where: { type_slug: { type: TYPE, slug: parsed.data.slug } },
    });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    const { categoryIds, ...rest } = parsed.data;
    const post = await prisma.post.create({
      data: {
        ...rest,
        type: TYPE,
        body: sanitizePostBody(rest.body),
        authorId: userId,
        ...(categoryIds ? { categories: { connect: categoryIds.map((id) => ({ id })) } } : {}),
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
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const role = request.session.get("role") as Role;
      if (!canEditContentFields(role, post.status)) {
        return reply.code(403).send({ error: "Bài đã lên lịch/xuất bản — chỉ manager/admin được sửa" });
      }

      const slugChanged = !!parsed.data.slug && parsed.data.slug !== post.slug;
      if (slugChanged) {
        const slugTaken = await prisma.post.findUnique({
          where: { type_slug: { type: TYPE, slug: parsed.data.slug! } },
        });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug đã tồn tại" });
        }
      }

      const { categoryIds, ...rest } = parsed.data;
      const userId = request.session.get("userId")!;

      // Snapshot NGUYEN VAN noi dung truoc khi ghi de - xem services/revisions.ts.
      await saveRevision(
        "Post",
        post.id,
        {
          title: post.title,
          slug: post.slug,
          body: post.body,
          excerpt: post.excerpt,
          coverImage: post.coverImage,
          seo: post.seo,
          password: post.password,
        },
        userId,
      );

      const updated = await prisma.post.update({
        where: { id: post.id },
        data: {
          ...rest,
          ...(rest.body ? { body: sanitizePostBody(rest.body) } : {}),
          ...(categoryIds ? { categories: { set: categoryIds.map((id) => ({ id })) } } : {}),
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

  app.get<{ Params: { id: string } }>(
    "/admin/api/posts/:id/revisions",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }
      const revisions = await listRevisions("Post", post.id);
      return { revisions };
    },
  );

  app.post<{ Params: { id: string; revisionId: string } }>(
    "/admin/api/posts/:id/revisions/:revisionId/restore",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const role = request.session.get("role") as Role;
      if (!canEditContentFields(role, post.status)) {
        return reply.code(403).send({ error: "Bài đã lên lịch/xuất bản — chỉ manager/admin được sửa" });
      }

      const revision = await prisma.revision.findUnique({ where: { id: request.params.revisionId } });
      if (!revision || revision.entityType !== "Post" || revision.entityId !== post.id) {
        return reply.code(404).send({ error: "Không tìm thấy bản ghi lịch sử" });
      }

      const userId = request.session.get("userId")!;
      // Snapshot trang thai HIEN TAI truoc khi ghi de bang ban cu - de "khoi phuc" cung xoa
      // duoc, khong mat du lieu.
      await saveRevision(
        "Post",
        post.id,
        {
          title: post.title,
          slug: post.slug,
          body: post.body,
          excerpt: post.excerpt,
          coverImage: post.coverImage,
          seo: post.seo,
          password: post.password,
        },
        userId,
      );

      const snapshot = revision.data as {
        title: string;
        slug: string;
        body: string;
        excerpt: string | null;
        coverImage: string | null;
        seo: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        password: string | null;
      };

      if (snapshot.slug !== post.slug) {
        const slugTaken = await prisma.post.findUnique({
          where: { type_slug: { type: TYPE, slug: snapshot.slug } },
        });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug trong bản ghi lịch sử đã bị bài khác dùng, không khôi phục được" });
        }
      }

      const updated = await prisma.post.update({ where: { id: post.id }, data: snapshot });
      await auditLog(userId, "post.restore", post.id, { revisionId: revision.id });

      return { post: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/posts/:id/submit",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { status: "pending_review" },
      });
      await auditLog(userId, "post.submit", post.id);

      return { post: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/posts/:id/publish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { status: "published", publishedAt: new Date(), scheduledAt: null },
      });
      await auditLog(userId, "post.publish", post.id);

      return { post: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/posts/:id/schedule",
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

      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { status: "scheduled", scheduledAt, publishedAt: null },
      });
      await auditLog(userId, "post.schedule", post.id, { scheduledAt: updated.scheduledAt });

      return { post: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/posts/:id/unpublish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { status: "draft", publishedAt: null, scheduledAt: null },
      });
      await auditLog(userId, "post.unpublish", post.id);

      return { post: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/posts/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const post = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!post || post.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      const userId = request.session.get("userId")!;
      await prisma.post.delete({ where: { id: post.id } });
      await auditLog(userId, "post.delete", post.id, { title: post.title, slug: post.slug });

      return { success: true };
    },
  );
}
