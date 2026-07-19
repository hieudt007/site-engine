import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { deleteUploadedFile, InvalidUploadError, saveUploadedFile } from "../../services/mediaStorage.js";

// Upload anh dung cho bai viet/san pham (coverImage/imageUrls dan URL tay) - "edit" can upload
// duoc de viet bai (giong quyen tao/sua bai nhap), nhung XOA vinh vien nang len "manager".
export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/media", { preHandler: requireRole("edit") }, async () => {
    const media = await prisma.media.findMany({ orderBy: { createdAt: "desc" } });
    return { media };
  });

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
