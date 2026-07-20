import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { customFieldsSchema } from "../../services/customFields.js";

const PAGE_SIZE = 20;

// Duyệt review — "manager" trở lên (§5.2, review gắn với sản phẩm, cùng nhóm quyền với products).
export async function registerReviewAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; status?: string } }>(
    "/admin/api/reviews",
    { preHandler: requireRole("manager") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const status = request.query.status || "pending";

      const where = { status };

      const [reviews, total] = await Promise.all([
        prisma.productReview.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { product: { select: { name: true } } },
        }),
        prisma.productReview.count({ where }),
      ]);

      return { reviews, total, page, hasNext: skip + reviews.length < total, hasPrev: page > 1 };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/api/reviews/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = z.object({ customFields: customFieldsSchema }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const review = await prisma.productReview.findUnique({ where: { id: request.params.id } });
      if (!review) {
        return reply.code(404).send({ error: "Không tìm thấy đánh giá" });
      }

      const updated = await prisma.productReview.update({ where: { id: review.id }, data: parsed.data });
      return { review: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/reviews/:id/approve",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const review = await prisma.productReview.findUnique({ where: { id: request.params.id } });
      if (!review) {
        return reply.code(404).send({ error: "Không tìm thấy đánh giá" });
      }
      const updated = await prisma.productReview.update({
        where: { id: review.id },
        data: { status: "approved" },
      });
      return { review: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/reviews/:id/reject",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const review = await prisma.productReview.findUnique({ where: { id: request.params.id } });
      if (!review) {
        return reply.code(404).send({ error: "Không tìm thấy đánh giá" });
      }
      const updated = await prisma.productReview.update({
        where: { id: review.id },
        data: { status: "rejected" },
      });
      return { review: updated };
    },
  );
}
