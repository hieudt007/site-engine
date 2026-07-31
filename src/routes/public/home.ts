import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { CacheService } from "../../services/CacheService.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { ensureProductSlugs } from "../../services/productSlug.js";

const LATEST_POSTS = 3;
const LATEST_PRODUCTS = 6;

// Trang chủ "/" — trước đây KHÔNG có route nào đăng ký cho "/", dù sitemap.xml đã khai nó tồn
// tại (routes/public/seo.ts) — khách bấm vào domain gốc rơi thẳng vào 404. Chỉ hiện bài/sản phẩm
// đã publish, cùng luật với /blog và /products.
export async function registerHomeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const siteConfig = await CacheService.getSiteConfig();
    const isBlog = siteConfig?.siteType === "blog";

    const [posts, productsRaw] = await Promise.all([
      CacheService.getLatestPosts(LATEST_POSTS),
      // siteType='blog' - KHONG query san pham
      isBlog ? Promise.resolve([]) : CacheService.getLatestProducts(LATEST_PRODUCTS),
    ]);
    const products = await ensureProductSlugs(productsRaw as any);

    const html = await renderPublic("home", { posts, products });
    return reply.type("text/html").send(html);
  });
}
