import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

// Dashboard tổng quan (system_design.md §8) — trước đây chỉ redirect thẳng sang /admin/posts,
// không có cái nhìn tổng quan nào. Đơn hàng lỗi gửi (CartOrder.status='failed') nổi bật riêng
// vì đây là thứ tenant CẦN biết ngay (cron retry chạy nền, nhưng vẫn nên biết có đơn đang lỗi).
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", { preHandler: requireRole("edit") }, async (request, reply) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      postsPublished,
      postsDraft,
      productsPublished,
      productsDraft,
      ordersRecent,
      ordersFailed,
      reviewsPending,
    ] = await Promise.all([
      prisma.post.count({ where: { status: "published" } }),
      prisma.post.count({ where: { status: { not: "published" } } }),
      prisma.productCache.count({ where: { status: "published" } }),
      prisma.productCache.count({ where: { status: { not: "published" } } }),
      prisma.cartOrder.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.cartOrder.count({ where: { status: "failed" } }),
      prisma.productReview.count({ where: { status: "pending" } }),
    ]);

    const html = await renderAdmin("dashboard", {
      pageTitle: "Tổng quan",
      userName: request.session.get("name"), role: request.session.get("role"),
      currentPath: request.url,
      stats: {
        postsPublished,
        postsDraft,
        productsPublished,
        productsDraft,
        ordersRecent,
        ordersFailed,
        reviewsPending,
      },
    });
    return reply.type("text/html").send(html);
  });
}
