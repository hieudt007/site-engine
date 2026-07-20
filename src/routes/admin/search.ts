import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { Role, requireRole } from "../../plugins/requireRole.js";

const RESULT_LIMIT = 6;

// Tìm kiếm nhanh toàn admin (thanh search trong sidebar, layout.liquid) — trước đây mỗi trang
// danh sách chỉ lọc riêng lẻ trong đúng loại nội dung đó, không có chỗ tra cứu nhanh xuyên loại.
// Sản phẩm chỉ trả về cho role "manager"/"admin" — khớp đúng ranh giới quyền của /admin/products
// (requireRole("manager")), tránh lộ tên sản phẩm cho role "edit" vốn không truy cập được trang đó.
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>(
    "/admin/api/search",
    { preHandler: requireRole("edit") },
    async (request) => {
      const q = (request.query.q ?? "").trim();
      if (!q) {
        return { posts: [], pages: [], products: [], media: [] };
      }

      const role = request.session.get("role") as Role;
      const canManage = role === "manager" || role === "admin";

      const [posts, pages, products, media] = await Promise.all([
        prisma.post.findMany({
          where: { type: "post", title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true },
          take: RESULT_LIMIT,
        }),
        prisma.post.findMany({
          where: { type: "page", title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true },
          take: RESULT_LIMIT,
        }),
        canManage
          ? prisma.productCache.findMany({
              where: { name: { contains: q, mode: "insensitive" } },
              select: { id: true, name: true },
              take: RESULT_LIMIT,
            })
          : Promise.resolve([]),
        prisma.media.findMany({
          where: { filename: { contains: q, mode: "insensitive" } },
          select: { id: true, filename: true },
          take: RESULT_LIMIT,
        }),
      ]);

      return { posts, pages, products, media };
    },
  );
}
