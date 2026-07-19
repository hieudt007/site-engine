import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";

const PAGE_SIZE = 12;

// Chỉ đọc ProductCache.publishStatus='published' (system_design.md §4.2/§8) — 'draft' (vừa
// sync từ LeadBase, chưa được website tự bổ sung nội dung) không lộ ra public.
export async function registerProductsPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string } }>("/products", async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    const where = { publishStatus: "published" };
    const [products, total] = await Promise.all([
      prisma.productCache.findMany({
        where,
        orderBy: { syncedAt: "desc" },
        skip,
        take: PAGE_SIZE,
      }),
      prisma.productCache.count({ where }),
    ]);

    const html = await renderPublic("products-list", {
      pageTitle: "Sản phẩm",
      products,
      hasPrev: page > 1,
      hasNext: skip + products.length < total,
      prevPage: page - 1,
      nextPage: page + 1,
    });

    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>("/products/:id", async (request, reply) => {
    const product = await prisma.productCache.findUnique({
      where: { id: request.params.id },
      include: { variants: true },
    });
    if (!product || product.publishStatus !== "published") {
      return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy sản phẩm</h1>");
    }

    // Escape "</" trước khi nhúng JSON vào <script> - tránh chuỗi thuộc tính variant (sku/attr)
    // vô tình chứa "</script>" phá vỡ thẻ script (an toàn hơn là tin dữ liệu do LeadBase gửi).
    const variantsJson = JSON.stringify(product.variants).replace(/<\//g, "<\\/");

    const html = await renderPublic("product-detail", {
      pageTitle: product.name,
      metaDescription: product.metaDescription ?? undefined,
      product,
      variantsJson,
    });

    return reply.type("text/html").send(html);
  });
}
