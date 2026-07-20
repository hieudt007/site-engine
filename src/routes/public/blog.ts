import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";

const PAGE_SIZE = 10;

// Route public — chỉ hiện bài status='published' (system_design.md §10). Không yêu cầu đăng
// nhập, khác hoàn toàn /admin/posts (§5, quản trị nội bộ).
export async function registerBlogRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string } }>("/blog", async (request, reply) => {
    const page = Math.max(1, Number(request.query.page ?? 1) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    const where = { type: "post", status: "published" };
    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { publishedAt: "desc" },
        skip,
        take: PAGE_SIZE,
        select: {
          slug: true,
          title: true,
          excerpt: true,
          coverImage: true,
          publishedAt: true,
          category: { select: { name: true, slug: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    const html = await renderPublic("blog-list", {
      pageTitle: "Blog",
      posts,
      hasPrev: page > 1,
      hasNext: skip + posts.length < total,
      prevPage: page - 1,
      nextPage: page + 1,
    });

    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/blog/danh-muc/:slug",
    async (request, reply) => {
      const category = await prisma.category.findUnique({
        where: { type_slug: { type: "post", slug: request.params.slug } },
      });
      if (!category) {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy danh mục</h1>");
      }

      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const where = { type: "post", status: "published", categoryId: category.id };

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          orderBy: { publishedAt: "desc" },
          skip,
          take: PAGE_SIZE,
          select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true },
        }),
        prisma.post.count({ where }),
      ]);

      const seo = readSeo(category.seo);
      const html = await renderPublic("blog-category", {
        pageTitle: seo.metaTitle ?? category.name,
        metaDescription: seo.metaDescription ?? category.excerpt ?? undefined,
        noindex: seo.noindex,
        category,
        posts,
        hasPrev: page > 1,
        hasNext: skip + posts.length < total,
        prevPage: page - 1,
        nextPage: page + 1,
      });

      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { slug: string } }>("/blog/:slug", async (request, reply) => {
    const post = await prisma.post.findUnique({
      where: { type_slug: { type: "post", slug: request.params.slug } },
      include: { category: { select: { name: true, slug: true } } },
    });
    if (!post || post.status !== "published") {
      // "/blog/:slug" la route DA DANG KY nen luon khop pattern - app.setNotFoundHandler()
      // (server.ts) KHONG BAO GIO chay toi day, phai tu tra Redirect ngay trong handler nay
      // (khac cac path hoan toan khong ton tai, moi roi xuong setNotFoundHandler that).
      const redirect = await prisma.redirect.findUnique({ where: { fromPath: request.url } });
      if (redirect) {
        return reply.code(redirect.statusCode).redirect(redirect.toPath);
      }
      return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy bài viết</h1>");
    }

    const seo = readSeo(post.seo);
    const html = await renderPublic("blog-post", {
      pageTitle: post.title,
      metaDescription: seo.metaDescription ?? post.excerpt ?? undefined,
      noindex: seo.noindex,
      post,
    });

    return reply.type("text/html").send(html);
  });
}
