import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";

const reviewSchema = z.object({
  customerName: z.string().min(1).max(255),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

// Khách KHÔNG cần tài khoản để đánh giá (Customer/OTP đang tạm dừng) — chỉ nhập tên. Luôn tạo
// ở "pending", PHẢI duyệt tay (routes/admin/reviews.ts) mới hiện công khai (system_design.md,
// tính năng review — nội dung công khai không đăng nhập, bắt buộc kiểm duyệt tránh spam).
export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/products/:id/reviews", async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
    if (!product || product.publishStatus !== "published") {
      return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
    }

    const review = await prisma.productReview.create({
      data: {
        productCacheId: product.id,
        customerName: parsed.data.customerName,
        rating: parsed.data.rating,
        comment: parsed.data.comment,
        status: "pending",
      },
    });

    return reply.code(201).send({ review: { id: review.id, status: review.status } });
  });
}
