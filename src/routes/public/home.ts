import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { ensureProductSlugs } from "../../services/productSlug.js";

const LATEST_POSTS = 3;
const LATEST_PRODUCTS = 6;

// Trang chủ "/" — trước đây KHÔNG có route nào đăng ký cho "/", dù sitemap.xml đã khai nó tồn
// tại (routes/public/seo.ts) — khách bấm vào domain gốc rơi thẳng vào 404. Chỉ hiện bài/sản phẩm
// đã publish, cùng luật với /blog và /products.
export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    const isBlog = siteConfig?.siteType === "blog";

    const [posts, productsRaw] = await Promise.all([
      prisma.post.findMany({
        where: { type: "post", status: "published" },
        orderBy: { publishedAt: "desc" },
        take: LATEST_POSTS,
        select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true },
      }),
      // siteType='blog' - KHONG query san pham, tranh trang chu van hien "san pham noi bat" du
      // toan bo route /products/cart da bi chan (server.ts onRequest hook) - link co bam vao
      // cung se 404, nhung tot hon la khong hien ra tu dau.
      isBlog
        ? Promise.resolve([])
        : prisma.productCache.findMany({
            where: { status: "published" },
            orderBy: { syncedAt: "desc" },
            take: LATEST_PRODUCTS,
            select: { id: true, slug: true, name: true, imageUrls: true, price: true, salePrice: true } as any,
          }),
    ]);
    const products = await ensureProductSlugs(productsRaw as any);

    const html = await renderPublic("home", { posts, products });
    return reply.type("text/html").send(html);
  });
}
