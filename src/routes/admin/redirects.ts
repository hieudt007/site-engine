import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// Đa số redirect tự tạo khi đổi slug bài viết (routes/admin/posts.ts) — màn này chỉ để XEM lại
// + bổ sung tay case đặc biệt (vd domain cũ trỏ URL ngoài), "manager" trở lên.
const redirectSchema = z.object({
  fromPath: z.string().min(1).refine((v) => v.startsWith("/"), "Phải bắt đầu bằng /"),
  toPath: z.string().min(1),
  statusCode: z.number().int().optional(),
});

export async function registerRedirectRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/redirects", { preHandler: requireRole("manager") }, async () => {
    const redirects = await prisma.redirect.findMany({ orderBy: { createdAt: "desc" } });
    return { redirects };
  });

  app.post("/admin/api/redirects", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = redirectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const existing = await prisma.redirect.findUnique({ where: { fromPath: parsed.data.fromPath } });
    if (existing) {
      return reply.code(409).send({ error: "Đường dẫn nguồn đã có redirect" });
    }

    const redirect = await prisma.redirect.create({
      data: { fromPath: parsed.data.fromPath, toPath: parsed.data.toPath, statusCode: parsed.data.statusCode ?? 301 },
    });
    return reply.code(201).send({ redirect });
  });

  app.delete<{ Params: { id: string } }>(
    "/admin/api/redirects/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const redirect = await prisma.redirect.findUnique({ where: { id: request.params.id } });
      if (!redirect) {
        return reply.code(404).send({ error: "Không tìm thấy redirect" });
      }
      await prisma.redirect.delete({ where: { id: redirect.id } });
      return { success: true };
    },
  );
}
