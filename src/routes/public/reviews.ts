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
  // Duyet tay o admin da chan noi dung spam hien cong khai (xem ghi chu tren), nhung khong
  // rate-limit thi ai cung co the lam phinh hang cho duyet vo han (DB growth + lam admin met moi
  // duyet). Gioi han o muc vua phai, khong anh huong khach that dang gui 1 review.
  app.post<{ Params: { id: string } }>(
    "/products/:id/reviews",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
    if (!product || product.status !== "published") {
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
    },
  );
}
