import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// Duyệt review — "manager" trở lên (§5.2, review gắn với sản phẩm, cùng nhóm quyền với products).
export async function registerReviewAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/reviews", { preHandler: requireRole("manager") }, async () => {
    const reviews = await prisma.productReview.findMany({
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true } } },
    });
    return { reviews };
  });

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
