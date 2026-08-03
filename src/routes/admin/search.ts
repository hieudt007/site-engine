import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { Role, requireRole } from "../../plugins/requireRole.js";

const RESULT_LIMIT = 6;

// Tìm kiếm nhanh toàn admin (thanh search trong sidebar, layout.liquid) — trước đây mỗi trang
// danh sách chỉ lọc riêng lẻ trong đúng loại nội dung đó, không có chỗ tra cứu nhanh xuyên loại.
// Sản phẩm chỉ trả về cho role "manager"/"admin" — khớp đúng ranh giới quyền của /admin/products
// (requireRole("manager")), tránh lộ tên sản phẩm cho role "edit" vốn không truy cập được trang đó.
export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; type?: string; excludeId?: string } }>(
    "/admin/api/search",
    { preHandler: requireRole("edit") },
    async (request) => {
      const q = (request.query.q ?? "").trim();
      const excludeId = request.query.excludeId;
      if (!q) {
        return { posts: [], pages: [], products: [], media: [], categories: [] };
      }

      const role = request.session.get("role") as Role;
      const canManage = role === "manager" || role === "admin";

      // type=category dung rieng cho picker "danh muc" cua upsell/cross-sell (product-edit.liquid)
      // - chi can danh muc san pham (type='product'), khong lien quan gi den posts/pages/media o duoi.
      if (request.query.type === "category") {
        if (!canManage) {
          return { posts: [], pages: [], products: [], media: [], categories: [] };
        }
        const categories = await prisma.category.findMany({
          where: { type: "product", name: { contains: q, mode: "insensitive" } },
          select: { id: true, name: true },
          take: RESULT_LIMIT,
        });
        return { posts: [], pages: [], products: [], media: [], categories };
      }

      const [posts, pages, products, media] = await Promise.all([
        prisma.post.findMany({
          where: { type: "post", title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true, slug: true },
          take: RESULT_LIMIT,
        }),
        prisma.post.findMany({
          where: { type: "page", title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true, slug: true },
          take: RESULT_LIMIT,
        }),
        canManage
          ? prisma.productCache.findMany({
              where: {
                name: { contains: q, mode: "insensitive" },
                ...(excludeId ? { id: { not: excludeId } } : {}),
              },
              select: { id: true, name: true, slug: true },
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
