import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { Role, requireRole } from "../../plugins/requireRole.js";
import { sanitizePostBody } from "../../services/sanitizeHtml.js";
import { canEditContentFields } from "../../services/contentStatus.js";

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

const createPageSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
  body: z.string().min(1),
  excerpt: z.string().optional(),
  coverImage: z.string().optional(),
  authorName: z.string().optional(),
  seo: seoSchema,
});

const updatePageSchema = createPageSchema.partial();
const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });
const PAGE_SIZE = 20;

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Page", entityId, metadata },
  });
}

// CRUD trang tĩnh + luồng duyệt 4 trạng thái — cùng luật với Post (posts.ts, xem
// services/contentStatus.ts): "edit" soạn/nộp duyệt, "manager"/"admin" lên lịch/xuất bản/xoá.
export async function registerPageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string; status?: string } }>(
    "/admin/api/pages",
    { preHandler: requireRole("edit") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const { q, status } = request.query;

      const where = {
        ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
        ...(status ? { status } : {}),
      };

      const [pages, total] = await Promise.all([
        prisma.page.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { author: { select: { name: true } } },
        }),
        prisma.page.count({ where }),
      ]);

      return { pages, total, page, hasNext: skip + pages.length < total, hasPrev: page > 1 };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/pages/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }
      return { page };
    },
  );

  app.post("/admin/api/pages", { preHandler: requireRole("edit") }, async (request, reply) => {
    const parsed = createPageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const userId = request.session.get("userId")!;
    const existing = await prisma.page.findUnique({ where: { slug: parsed.data.slug } });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    const page = await prisma.page.create({
      data: {
        ...parsed.data,
        body: sanitizePostBody(parsed.data.body),
        authorId: userId,
        updatedByUserId: userId,
      },
    });
    await auditLog(userId, "page.create", page.id);

    return reply.code(201).send({ page });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/pages/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const parsed = updatePageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const role = request.session.get("role") as Role;
      if (!canEditContentFields(role, page.status)) {
        return reply.code(403).send({ error: "Trang đã lên lịch/xuất bản — chỉ manager/admin được sửa" });
      }

      const slugChanged = !!parsed.data.slug && parsed.data.slug !== page.slug;
      if (slugChanged) {
        const slugTaken = await prisma.page.findUnique({ where: { slug: parsed.data.slug } });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug đã tồn tại" });
        }
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.page.update({
        where: { id: page.id },
        data: {
          ...parsed.data,
          ...(parsed.data.body ? { body: sanitizePostBody(parsed.data.body) } : {}),
          updatedByUserId: userId,
        },
      });
      await auditLog(userId, "page.update", page.id);

      if (slugChanged) {
        const fromPath = `/trang/${page.slug}`;
        const toPath = `/trang/${updated.slug}`;
        await prisma.redirect.upsert({
          where: { fromPath },
          create: { fromPath, toPath },
          update: { toPath },
        });
      }

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/submit",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.page.update({
        where: { id: page.id },
        data: { status: "pending_review", updatedByUserId: userId },
      });
      await auditLog(userId, "page.submit", page.id);

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/publish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.page.update({
        where: { id: page.id },
        data: { status: "published", publishedAt: new Date(), scheduledAt: null, updatedByUserId: userId },
      });
      await auditLog(userId, "page.publish", page.id);

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/schedule",
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

      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.page.update({
        where: { id: page.id },
        data: { status: "scheduled", scheduledAt, publishedAt: null, updatedByUserId: userId },
      });
      await auditLog(userId, "page.schedule", page.id, { scheduledAt: updated.scheduledAt });

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/unpublish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.page.update({
        where: { id: page.id },
        data: { status: "draft", publishedAt: null, scheduledAt: null, updatedByUserId: userId },
      });
      await auditLog(userId, "page.unpublish", page.id);

      return { page: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/pages/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const page = await prisma.page.findUnique({ where: { id: request.params.id } });
      if (!page) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      await prisma.page.delete({ where: { id: page.id } });
      await auditLog(userId, "page.delete", page.id, { title: page.title, slug: page.slug });

      return { success: true };
    },
  );
}
