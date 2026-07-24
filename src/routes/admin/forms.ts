import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { z } from "zod";

export async function registerAdminFormsRoutes(app: FastifyInstance): Promise<void> {
  // Lấy danh sách forms (phân trang)
  app.get("/admin/api/forms", { preHandler: requireRole("edit") }, async (request, reply) => {
    try {
      const { page = 1, limit = 20, formName } = request.query as any;
      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);

      const where = formName ? { formName: { contains: formName, mode: "insensitive" } as any } : {};

      const [submissions, total] = await Promise.all([
        prisma.formSubmission.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: "desc" },
        }),
        prisma.formSubmission.count({ where }),
      ]);

      return reply.send({
        data: submissions,
        pagination: {
          total,
          page: Number(page),
          limit: take,
          totalPages: Math.ceil(total / take),
        },
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Lỗi lấy danh sách forms" });
    }
  });

  // Xóa 1 form
  app.delete("/admin/api/forms/:id", { preHandler: requireRole("edit") }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await prisma.formSubmission.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ message: "Lỗi xóa form" });
    }
  });
}
