import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

const PAGE_SIZE = 20;

// Đơn hàng khách đặt qua chính website — CHỈ ĐỌC (đơn thật/chỉnh sửa nằm ở LeadBase CRM, nơi
// Order thật được tạo qua SiteEngineOrderController). requireRole("manager") — cùng nhóm quyền
// thương mại với products.ts. "failed" đáng chú ý nhất (cron retry chạy nền nhưng vẫn nên biết).
export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; status?: string } }>(
    "/admin/api/orders",
    { preHandler: requireRole("manager") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const status = request.query.status;

      const where = status ? { status } : {};
      const [orders, total] = await Promise.all([
        prisma.cartOrder.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
        }),
        prisma.cartOrder.count({ where }),
      ]);

      return { orders, total, page, totalPages: Math.ceil(total / PAGE_SIZE), hasNext: skip + orders.length < total, hasPrev: page > 1 };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/orders/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const order = await prisma.cartOrder.findUnique({ where: { id: request.params.id } });
      if (!order) {
        return reply.code(404).send({ error: "Không tìm thấy đơn hàng" });
      }
      return { order };
    },
  );
}
