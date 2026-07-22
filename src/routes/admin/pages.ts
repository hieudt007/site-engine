import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { Role, requireRole } from "../../plugins/requireRole.js";
import { sanitizePostBody } from "../../services/sanitizeHtml.js";
import { canEditContentFields } from "../../services/contentStatus.js";
import { saveRevision, listRevisions } from "../../services/revisions.js";
import { customFieldsSchema } from "../../services/customFields.js";

const TYPE = "page";

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
  layoutMode: z.enum(["standard", "custom", "landing"]).optional(),
  seo: seoSchema,
  customFields: customFieldsSchema,
});

const updatePageSchema = createPageSchema.partial();
const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });
const PAGE_SIZE = 20;

// 'standard' -> sanitize nhu binh thuong. 'custom'/'landing' -> KHONG sanitize, cho phep
// script/iframe - xem docblock Post.layoutMode trong schema.prisma cho ly do thiet ke day du.
function resolveBody(body: string, layoutMode: string | undefined): string {
  return layoutMode === "custom" || layoutMode === "landing" ? body : sanitizePostBody(body);
}

function auditLog(userId: number, action: string, entityId: string, metadata?: object) {
  return prisma.auditLog.create({
    data: { userId, action, entityType: "Page", entityId, metadata },
  });
}

// CRUD trang tĩnh + luồng duyệt 4 trạng thái — cùng luật với Post (posts.ts, xem
// services/contentStatus.ts). Dùng CHUNG bảng Post, phân biệt qua type='page' — mọi query ở
// đây LUÔN lọc/set type='page' để không bao giờ lộ/động vào bài viết blog.
export async function registerPageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string; status?: string } }>(
    "/admin/api/pages",
    { preHandler: requireRole("edit") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const { q, status } = request.query;

      const where = {
        type: TYPE,
        ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
        ...(status ? { status } : {}),
      };

      const [pages, total] = await Promise.all([
        prisma.post.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { author: { select: { name: true } } },
        }),
        prisma.post.count({ where }),
      ]);

      return { pages, total, page, hasNext: skip + pages.length < total, hasPrev: page > 1 };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/pages/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
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
    const existing = await prisma.post.findFirst({
      where: { type: { in: ["post", "page"] }, slug: parsed.data.slug },
    });
    if (existing) {
      return reply.code(409).send({ error: "Slug đã tồn tại" });
    }

    const page = await prisma.post.create({
      data: {
        ...parsed.data,
        type: TYPE,
        body: resolveBody(parsed.data.body, parsed.data.layoutMode),
        authorId: userId,
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

      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const role = request.session.get("role") as Role;
      if (!canEditContentFields(role, page.status)) {
        return reply.code(403).send({ error: "Trang đã lên lịch/xuất bản — chỉ manager/admin được sửa" });
      }

      const slugChanged = !!parsed.data.slug && parsed.data.slug !== page.slug;
      if (slugChanged) {
        const slugTaken = await prisma.post.findFirst({
          where: { type: { in: ["post", "page"] }, slug: parsed.data.slug!, id: { not: page.id } },
        });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug đã tồn tại" });
        }
      }

      const userId = request.session.get("userId")!;
      const effectiveLayoutMode = parsed.data.layoutMode ?? page.layoutMode;
      const sanitizedData = parsed.data.body
        ? { ...parsed.data, body: resolveBody(parsed.data.body, effectiveLayoutMode) }
        : parsed.data;

      await saveRevision(
        "Page",
        page.id,
        {
          title: page.title,
          slug: page.slug,
          body: page.body,
          excerpt: page.excerpt,
          coverImage: page.coverImage,
          seo: page.seo,
          customFields: page.customFields,
          layoutMode: page.layoutMode,
        },
        sanitizedData,
        userId,
      );

      const updated = await prisma.post.update({
        where: { id: page.id },
        data: sanitizedData,
      });
      await auditLog(userId, "page.update", page.id);

      if (slugChanged) {
        const fromPath = `/${page.slug}`;
        const toPath = `/${updated.slug}`;
        await prisma.redirect.upsert({
          where: { fromPath },
          create: { fromPath, toPath },
          update: { toPath },
        });
      }

      return { page: updated };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/pages/:id/revisions",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }
      const revisions = await listRevisions("Page", page.id);
      return { revisions };
    },
  );

  app.post<{ Params: { id: string; revisionId: string } }>(
    "/admin/api/pages/:id/revisions/:revisionId/restore",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const role = request.session.get("role") as Role;
      if (!canEditContentFields(role, page.status)) {
        return reply.code(403).send({ error: "Trang đã lên lịch/xuất bản — chỉ manager/admin được sửa" });
      }

      const revision = await prisma.revision.findUnique({ where: { id: request.params.revisionId } });
      if (!revision || revision.entityType !== "Page" || revision.entityId !== page.id) {
        return reply.code(404).send({ error: "Không tìm thấy bản ghi lịch sử" });
      }

      const userId = request.session.get("userId")!;

      const snapshot = revision.data as {
        title: string;
        slug: string;
        body: string;
        excerpt: string | null;
        coverImage: string | null;
        seo: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        customFields: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        layoutMode?: string;
      };

      await saveRevision(
        "Page",
        page.id,
        {
          title: page.title,
          slug: page.slug,
          body: page.body,
          excerpt: page.excerpt,
          coverImage: page.coverImage,
          seo: page.seo,
          customFields: page.customFields,
          layoutMode: page.layoutMode,
        },
        snapshot,
        userId,
      );

      if (snapshot.slug !== page.slug) {
        const slugTaken = await prisma.post.findUnique({
          where: { type_slug: { type: TYPE, slug: snapshot.slug } },
        });
        if (slugTaken) {
          return reply.code(409).send({ error: "Slug trong bản ghi lịch sử đã bị trang khác dùng, không khôi phục được" });
        }
      }

      const updated = await prisma.post.update({ where: { id: page.id }, data: snapshot });
      await auditLog(userId, "page.restore", page.id, { revisionId: revision.id });

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/submit",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: page.id },
        data: { status: "pending_review" },
      });
      await auditLog(userId, "page.submit", page.id);

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/publish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: page.id },
        data: { status: "published", publishedAt: new Date(), scheduledAt: null },
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

      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: page.id },
        data: { status: "scheduled", scheduledAt, publishedAt: null },
      });
      await auditLog(userId, "page.schedule", page.id, { scheduledAt: updated.scheduledAt });

      return { page: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/pages/:id/unpublish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      const updated = await prisma.post.update({
        where: { id: page.id },
        data: { status: "draft", publishedAt: null, scheduledAt: null },
      });
      await auditLog(userId, "page.unpublish", page.id);

      return { page: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/pages/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const page = await prisma.post.findUnique({ where: { id: request.params.id } });
      if (!page || page.type !== TYPE) {
        return reply.code(404).send({ error: "Không tìm thấy trang" });
      }

      const userId = request.session.get("userId")!;
      await prisma.post.delete({ where: { id: page.id } });
      await auditLog(userId, "page.delete", page.id, { title: page.title, slug: page.slug });

      return { success: true };
    },
  );
}
