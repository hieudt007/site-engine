import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { deleteUploadedFile, InvalidUploadError, saveUploadedFile } from "../../services/mediaStorage.js";

const updateMediaSchema = z.object({ alt: z.string().max(300).optional() });

// Upload anh dung cho bai viet/san pham (coverImage/imageUrls dan URL tay) - "edit" can upload
// duoc de viet bai (giong quyen tao/sua bai nhap), nhung XOA vinh vien nang len "manager".
const PAGE_SIZE = 20;

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string } }>(
    "/admin/api/media",
    { preHandler: requireRole("edit") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const q = request.query.q?.trim();

      const where = q
        ? {
            OR: [
              { filename: { contains: q, mode: "insensitive" as const } },
              { alt: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {};

      const [media, total] = await Promise.all([
        prisma.media.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: PAGE_SIZE }),
        prisma.media.count({ where }),
      ]);

      return { media, total, page, totalPages: Math.ceil(total / PAGE_SIZE), hasNext: skip + media.length < total, hasPrev: page > 1 };
    },
  );

  app.post("/admin/api/media", { preHandler: requireRole("edit") }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.code(422).send({ error: "Thiếu file" });
    }

    const buffer = await file.toBuffer();

    try {
      const { url, filename } = await saveUploadedFile(buffer, file.mimetype);
      const userId = request.session.get("userId")!;

      const media = await prisma.media.create({
        data: {
          filename: file.filename || filename,
          url,
          mimeType: file.mimetype,
          size: buffer.length,
          uploadedByUserId: userId,
        },
      });

      return reply.code(201).send({ media });
    } catch (err) {
      if (err instanceof InvalidUploadError) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/media/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const parsed = updateMediaSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const media = await prisma.media.findUnique({ where: { id: request.params.id } });
      if (!media) {
        return reply.code(404).send({ error: "Không tìm thấy file" });
      }
      const updated = await prisma.media.update({ where: { id: media.id }, data: { alt: parsed.data.alt ?? null } });
      return { media: updated };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/media/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const media = await prisma.media.findUnique({ where: { id: request.params.id } });
      if (!media) {
        return reply.code(404).send({ error: "Không tìm thấy file" });
      }

      await deleteUploadedFile(media.url);
      await prisma.media.delete({ where: { id: media.id } });

      return { success: true };
    },
  );
}
