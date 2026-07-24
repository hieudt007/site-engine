import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { buildArticleSchema, buildBreadcrumbSchema, buildProductSchema } from "../../services/schema.js";
import { pagePath, pagePrefix, postCategoryPath, postPath, productCategoryPath, productPath, productPrefix, topicPath as topicUrlPath } from "../../services/urlPaths.js";
import { ensureProductSlug } from "../../services/productSlug.js";

// URL tuyet doi + thong tin site cho JSON-LD (BlogPosting.publisher...) - xem cung ly do trong
// routes/public/products.ts.
async function siteInfo(): Promise<{ siteName: string; logoUrl: string | null; domain: string; baseUrl: string }> {
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  const domain = siteConfig?.domain ?? "localhost";
  return {
    siteName: siteConfig?.siteName ?? "Website",
    logoUrl: siteConfig?.logoUrl ?? null,
    domain,
    baseUrl: domain.startsWith("http") ? domain : `https://${domain}`,
  };
}

const PAGE_SIZE = 10;

async function siteUrlConfig() {
  const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  return config as { postSlugPrefix?: string | null; productSlugPrefix?: string | null } | null;
}

function queryString(url: string): string {
  const index = url.indexOf("?");
  return index >= 0 ? url.slice(index) : "";
}

// Cookie riêng cho từng bài có mật khẩu (khác cookie session admin) - đặt sau khi khách nhập
// đúng mật khẩu, chỉ đơn giản là "đã từng nhập đúng", không phải token đăng nhập thật.
function unlockCookieName(postId: string): string {
  return `post_unlock_${postId}`;
}

export async function renderPostBySlug(slug: string, request: FastifyRequest, reply: FastifyReply) {
  const post = await prisma.post.findUnique({
    where: { type_slug: { type: "post", slug } },
    include: { categories: { select: { name: true, slug: true } } },
  });
  if (!post || post.status !== "published") {
    const redirect = await prisma.redirect.findUnique({ where: { fromPath: request.url } });
    if (redirect) {
      return reply.code(redirect.statusCode).redirect(redirect.toPath);
    }
    return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy bài viết"));
  }

  const seo = readSeo(post.seo);

  if (post.password) {
    const unlocked = request.cookies[unlockCookieName(post.id)] === "1";
    if (!unlocked) {
      const html = await renderPublic("blog-post-locked", {
        pageTitle: post.title,
        noindex: true,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Blog", url: "/blog" },
          { name: post.title, url: postPath((await siteUrlConfig()) ?? {}, post.slug) },
        ],
        breadcrumbVariant: "blog",
        slug: post.slug,
      });
      return reply.type("text/html").send(html);
    }
  }

  const pageData = {
    pageTitle: seo.metaTitle || post.title,
    metaDescription: seo.metaDescription || post.excerpt || undefined,
    noindex: seo.noindex,
  };

  let html: string;
  if (post.layoutMode === "landing") {
    html = await renderPublic("landing", { ...pageData, rawHtml: post.body });
  } else if (post.layoutMode === "custom") {
    html = await renderPublic("custom-content", { ...pageData, rawHtml: post.body });
  } else {
    const site = await siteInfo();
    const urlConfig = await siteUrlConfig();
    const postUrl = new URL(postPath(urlConfig ?? {}, post.slug), site.baseUrl).toString();
    const breadcrumbItems = [
      { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
      { name: "Blog", url: new URL("/blog", site.baseUrl).toString() },
      ...(post.categories[0] ? [{ name: post.categories[0].name, url: new URL(postCategoryPath(urlConfig ?? {}, post.categories[0].slug), site.baseUrl).toString() }] : []),
      { name: post.title, url: postUrl },
    ];
    const schemas = [buildArticleSchema(post, site, postUrl), buildBreadcrumbSchema(breadcrumbItems)];

    let relatedPosts: any[] = [];
    if (post.categories.length > 0) {
      relatedPosts = await prisma.post.findMany({
        where: { type: "post", status: "published", id: { not: post.id }, categories: { some: { slug: { in: post.categories.map(c => c.slug) } } } },
        orderBy: { publishedAt: "desc" },
        take: 3,
        include: { categories: { select: { name: true, slug: true } } }
      });
    }

    html = await renderPublic("blog-post", {
      ...pageData,
      breadcrumbs: [
        { name: "Trang chủ", url: "/" },
        { name: "Blog", url: "/blog" },
        ...(post.categories[0] ? [{ name: post.categories[0].name, url: postCategoryPath(urlConfig ?? {}, post.categories[0].slug) }] : []),
        { name: post.title, url: postPath(urlConfig ?? {}, post.slug) },
      ],
      breadcrumbVariant: "blog",
      post,
      relatedPosts,
      schemas,
    });
  }

  return reply.type("text/html").send(html);
}

export async function renderPostCategoryBySlug(slug: string, request: FastifyRequest<{ Querystring: { page?: string } }>, reply: FastifyReply) {
  const category = await prisma.category.findUnique({
    where: { type_slug: { type: "post", slug } },
    include: { children: { select: { name: true, slug: true } } },
  });
  if (!category) {
    return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy danh mục"));
  }

  const page = Math.max(1, Number(request.query.page ?? 1) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const where = { type: "post", status: "published", categories: { some: { id: category.id } } };
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
  const site = await siteInfo();
  const urlConfig = await siteUrlConfig();
  const categoryPath = postCategoryPath(urlConfig ?? {}, category.slug);
  const breadcrumbItems = [
    { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
    { name: "Blog", url: new URL("/blog", site.baseUrl).toString() },
    { name: category.name, url: new URL(categoryPath, site.baseUrl).toString() },
  ];
  const html = await renderPublic("blog-category", {
    pageTitle: seo.metaTitle ?? category.name,
    metaDescription: seo.metaDescription ?? category.excerpt ?? undefined,
    noindex: seo.noindex,
    breadcrumbs: [
      { name: "Trang chủ", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: category.name, url: categoryPath },
    ],
    breadcrumbVariant: "blog",
    category,
    categoryPath,
    backHref: "/blog",
    backLabel: "Tất cả bài viết",
    childPathPrefix: postCategoryPath(urlConfig ?? {}, "").replace(/\/$/, ""),
    emptyText: "Chưa có bài viết nào trong danh mục này.",
    posts,
    hasPrev: page > 1,
    hasNext: skip + posts.length < total,
    prevPage: page - 1,
    nextPage: page + 1,
    currentPage: page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    schemas: [buildBreadcrumbSchema(breadcrumbItems)],
  });

  return reply.type("text/html").send(html);
}

export async function renderTopicBySlug(slug: string, request: FastifyRequest<{ Querystring: { page?: string } }>, reply: FastifyReply) {
  const topic = await prisma.topic.findUnique({ where: { slug } });
  if (!topic) {
    return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy chủ đề"));
  }

  const page = Math.max(1, Number(request.query.page ?? 1) || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const where = { type: "post", status: "published", topicId: topic.id };
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

  const site = await siteInfo();
  const urlConfig = await siteUrlConfig();
  const category = { name: topic.name, slug: topic.slug, excerpt: null, body: null, customFields: topic.customFields, children: [] };
  const categoryPath = topicUrlPath(urlConfig ?? {}, topic.slug);
  const breadcrumbItems = [
    { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
    { name: "Blog", url: new URL("/blog", site.baseUrl).toString() },
    { name: topic.name, url: new URL(categoryPath, site.baseUrl).toString() },
  ];
  const html = await renderPublic("blog-category", {
    pageTitle: topic.name,
    breadcrumbs: [
      { name: "Trang chủ", url: "/" },
      { name: "Blog", url: "/blog" },
      { name: topic.name, url: categoryPath },
    ],
    breadcrumbVariant: "blog",
    category,
    categoryPath,
    backHref: "/blog",
    backLabel: "Tất cả bài viết",
    emptyText: "Chưa có bài viết nào trong chủ đề này.",
    posts,
    hasPrev: page > 1,
    hasNext: skip + posts.length < total,
    prevPage: page - 1,
    nextPage: page + 1,
    currentPage: page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    schemas: [buildBreadcrumbSchema(breadcrumbItems)],
  });

  return reply.type("text/html").send(html);
}

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
          categories: { select: { name: true, slug: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    const html = await renderPublic("blog-list", {
      pageTitle: "Blog",
      breadcrumbs: [
        { name: "Trang chủ", url: "/" },
        { name: "Blog", url: "/blog" },
      ],
      breadcrumbVariant: "blog",
      posts,
      hasPrev: page > 1,
      hasNext: skip + posts.length < total,
      prevPage: page - 1,
      nextPage: page + 1,
      currentPage: page,
      totalPages: Math.ceil(total / PAGE_SIZE),
    });

    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/danh-muc/:slug",
    async (request, reply) => {
      const category = await prisma.category.findUnique({
        where: { type_slug: { type: "post", slug: request.params.slug } },
        include: { children: { select: { name: true, slug: true } } },
      });
      if (!category) {
        return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy danh mục"));
      }

      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const where = { type: "post", status: "published", categories: { some: { id: category.id } } };

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
      const site = await siteInfo();
      const urlConfig = await siteUrlConfig();
      const categoryPath = postCategoryPath(urlConfig ?? {}, category.slug);
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
        { name: "Blog", url: new URL("/blog", site.baseUrl).toString() },
        { name: category.name, url: new URL(categoryPath, site.baseUrl).toString() },
      ];
      const html = await renderPublic("blog-category", {
        pageTitle: seo.metaTitle ?? category.name,
        metaDescription: seo.metaDescription ?? category.excerpt ?? undefined,
        noindex: seo.noindex,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Blog", url: "/blog" },
          { name: category.name, url: categoryPath },
        ],
        breadcrumbVariant: "blog",
        category,
        categoryPath,
        backHref: "/blog",
        backLabel: "Tất cả bài viết",
        childPathPrefix: postCategoryPath(urlConfig ?? {}, "").replace(/\/$/, ""),
        emptyText: "Chưa có bài viết nào trong danh mục này.",
        posts,
        hasPrev: page > 1,
        hasNext: skip + posts.length < total,
        prevPage: page - 1,
        nextPage: page + 1,
        currentPage: page,
        totalPages: Math.ceil(total / PAGE_SIZE),
        schemas: [buildBreadcrumbSchema(breadcrumbItems)],
      });

      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/blog/danh-muc/:slug",
    async (request, reply) => {
      const target = postCategoryPath((await siteUrlConfig()) ?? {}, request.params.slug);
      if (target !== `/blog/danh-muc/${request.params.slug}`) {
        return reply.redirect(target + queryString(request.url));
      }
      return renderPostCategoryBySlug(request.params.slug, request, reply);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/chu-de/:slug",
    async (request, reply) => {
      const topic = await prisma.topic.findUnique({ where: { slug: request.params.slug } });
      if (!topic) {
        return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy chủ đề"));
      }

      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const where = { type: "post", status: "published", topicId: topic.id };

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

      const site = await siteInfo();
      const category = {
        name: topic.name,
        slug: topic.slug,
        excerpt: null,
        body: null,
        customFields: topic.customFields,
        children: [],
      };
      const urlConfig = await siteUrlConfig();
      const categoryPath = topicUrlPath(urlConfig ?? {}, topic.slug);
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
        { name: "Blog", url: new URL("/blog", site.baseUrl).toString() },
        { name: topic.name, url: new URL(categoryPath, site.baseUrl).toString() },
      ];
      const html = await renderPublic("blog-category", {
        pageTitle: topic.name,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Blog", url: "/blog" },
          { name: topic.name, url: categoryPath },
        ],
        breadcrumbVariant: "blog",
        category,
        categoryPath,
        backHref: "/blog",
        backLabel: "Tất cả bài viết",
        emptyText: "Chưa có bài viết nào trong chủ đề này.",
        posts,
        hasPrev: page > 1,
        hasNext: skip + posts.length < total,
        prevPage: page - 1,
        nextPage: page + 1,
        currentPage: page,
        totalPages: Math.ceil(total / PAGE_SIZE),
        schemas: [buildBreadcrumbSchema(breadcrumbItems)],
      });

      return reply.type("text/html").send(html);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { page?: string } }>(
    "/blog/chu-de/:slug",
    async (request, reply) => {
      const target = topicUrlPath((await siteUrlConfig()) ?? {}, request.params.slug);
      if (target !== `/blog/chu-de/${request.params.slug}`) {
        return reply.redirect(target + queryString(request.url));
      }
      return renderTopicBySlug(request.params.slug, request, reply);
    },
  );

  app.get<{ Params: { slug: string } }>("/blog/:slug", async (request, reply) => {
    const target = postPath((await siteUrlConfig()) ?? {}, request.params.slug);
    if (target !== `/blog/${request.params.slug}`) {
      return reply.redirect(target + queryString(request.url));
    }
    return renderPostBySlug(request.params.slug, request, reply);
  });

  app.get<{ Params: { slug: string } }>("/blog/:slug/unlock", async (request, reply) => {
    return reply.redirect(`${postPath((await siteUrlConfig()) ?? {}, request.params.slug)}/unlock`);
  });

  app.get<{ Params: { slug: string } }>("/:slug", async (request, reply) => {
    const page = await prisma.post.findUnique({
      where: { type_slug: { type: "page", slug: request.params.slug } },
    });
    if (page?.status === "published") {
      const urlConfig = await siteUrlConfig();
      if (pagePrefix(urlConfig ?? {}) !== "") {
        return reply.redirect(pagePath(urlConfig ?? {}, page.slug) + queryString(request.url));
      }
      const seo = readSeo(page.seo);
      const pageData = {
        pageTitle: page.title,
        metaDescription: seo.metaDescription ?? page.excerpt ?? undefined,
        noindex: seo.noindex,
      };

      if (page.layoutMode === "landing") {
        const html = await renderPublic("landing", { ...pageData, rawHtml: page.body });
        return reply.type("text/html").send(html);
      }
      if (page.layoutMode === "custom") {
        const html = await renderPublic("custom-content", { ...pageData, rawHtml: page.body });
        return reply.type("text/html").send(html);
      }

      const html = await renderPublic("page", {
        ...pageData,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: page.title, url: pagePath(urlConfig ?? {}, page.slug) },
        ],
        breadcrumbVariant: "default",
        page,
      });
      return reply.type("text/html").send(html);
    }

    const post = await prisma.post.findUnique({
      where: { type_slug: { type: "post", slug: request.params.slug } },
      include: { categories: { select: { name: true, slug: true } } },
    });
    if (!post || post.status !== "published") {
      const urlConfig = await siteUrlConfig();
      if (productPrefix(urlConfig ?? {}) === "") {
        const product =
          (await prisma.productCache.findUnique({
            where: { slug: request.params.slug } as any,
            include: { variants: true, categories: { select: { name: true, slug: true } } },
          })) ??
          (await prisma.productCache.findUnique({
            where: { id: request.params.slug },
            include: { variants: true, categories: { select: { name: true, slug: true } } },
          }));
        if (product?.status === "published") {
          await ensureProductSlug(product as any);
          const productSlug = ((product as any).slug as string | null | undefined) ?? product.id;
          if (request.params.slug !== productSlug) {
            return reply.redirect(productPath(urlConfig ?? {}, productSlug));
          }
          const variantsJson = JSON.stringify(product.variants).replace(/<\//g, "<\\/");
          const reviews = await prisma.productReview.findMany({
            where: { productCacheId: product.id, status: "approved" },
            orderBy: { createdAt: "desc" },
          });
          const pageData = { pageTitle: product.name, metaDescription: readSeo(product.seo).metaDescription };
          if (product.layoutMode === "landing") {
            const html = await renderPublic("landing", { ...pageData, rawHtml: product.description ?? "" });
            return reply.type("text/html").send(html);
          }
          if (product.layoutMode === "custom") {
            const html = await renderPublic("custom-content", { ...pageData, rawHtml: product.description ?? "" });
            return reply.type("text/html").send(html);
          }
          const site = await siteInfo();
          const productUrl = new URL(productPath(urlConfig ?? {}, productSlug), site.baseUrl).toString();
          const breadcrumbItems = [
            { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
            { name: "Sản phẩm", url: new URL("/products", site.baseUrl).toString() },
            ...(product.categories[0] ? [{ name: product.categories[0].name, url: new URL(productCategoryPath(urlConfig ?? {}, product.categories[0].slug), site.baseUrl).toString() }] : []),
            { name: product.name, url: productUrl },
          ];
          const schemas = [buildProductSchema(product, productUrl, reviews), buildBreadcrumbSchema(breadcrumbItems)];
          const html = await renderPublic("product-detail", {
            ...pageData,
            breadcrumbs: [
              { name: "Trang chủ", url: "/" },
              { name: "Sản phẩm", url: "/products" },
              ...(product.categories[0] ? [{ name: product.categories[0].name, url: productCategoryPath(urlConfig ?? {}, product.categories[0].slug) }] : []),
              { name: product.name, url: productPath(urlConfig ?? {}, productSlug) },
            ],
            breadcrumbVariant: "product",
            product,
            variantsJson,
            reviews,
            avgRating: product.avgRating,
            schemas,
            upsellProducts: [],
            crossSellProducts: [],
          });
          return reply.type("text/html").send(html);
        }
      }

      // "/blog/:slug" la route DA DANG KY nen luon khop pattern - app.setNotFoundHandler()
      // (server.ts) KHONG BAO GIO chay toi day, phai tu tra Redirect ngay trong handler nay
      // (khac cac path hoan toan khong ton tai, moi roi xuong setNotFoundHandler that).
      const redirect = await prisma.redirect.findUnique({ where: { fromPath: request.url } });
      if (redirect) {
        return reply.code(redirect.statusCode).redirect(redirect.toPath);
      }
      return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy bài viết"));
    }

    const seo = readSeo(post.seo);

    if (post.password) {
      const unlocked = request.cookies[unlockCookieName(post.id)] === "1";
      if (!unlocked) {
        const html = await renderPublic("blog-post-locked", {
          pageTitle: post.title,
          noindex: true,
          breadcrumbs: [
            { name: "Trang chủ", url: "/" },
            { name: "Blog", url: "/blog" },
            { name: post.title, url: postPath((await siteUrlConfig()) ?? {}, post.slug) },
          ],
          breadcrumbVariant: "blog",
          slug: post.slug,
        });
        return reply.type("text/html").send(html);
      }
    }

    const pageData = {
      pageTitle: post.title,
      metaDescription: seo.metaDescription ?? post.excerpt ?? undefined,
      noindex: seo.noindex,
    };

    // 'standard' -> khung theme chuan (blog-post.liquid). 'custom' -> van co header/footer nhung
    // body render THO khong qua khung tieu de/category. 'landing' -> khong header/footer/layout gi
    // ca - xem docblock Post.layoutMode (schema.prisma) cho ly do thiet ke day du.
    let html: string;
    if (post.layoutMode === "landing") {
      html = await renderPublic("landing", { ...pageData, rawHtml: post.body });
    } else if (post.layoutMode === "custom") {
      html = await renderPublic("custom-content", { ...pageData, rawHtml: post.body });
    } else {
      const site = await siteInfo();
      const urlConfig = await siteUrlConfig();
      const postUrl = new URL(postPath(urlConfig ?? {}, post.slug), site.baseUrl).toString();
      const breadcrumbItems = [
        { name: "Trang chủ", url: new URL("/", site.baseUrl).toString() },
        { name: "Blog", url: new URL("/blog", site.baseUrl).toString() },
        ...(post.categories[0] ? [{ name: post.categories[0].name, url: new URL(postCategoryPath(urlConfig ?? {}, post.categories[0].slug), site.baseUrl).toString() }] : []),
        { name: post.title, url: postUrl },
      ];
      const schemas = [buildArticleSchema(post, site, postUrl), buildBreadcrumbSchema(breadcrumbItems)];
      html = await renderPublic("blog-post", {
        ...pageData,
        breadcrumbs: [
          { name: "Trang chủ", url: "/" },
          { name: "Blog", url: "/blog" },
          ...(post.categories[0] ? [{ name: post.categories[0].name, url: postCategoryPath(urlConfig ?? {}, post.categories[0].slug) }] : []),
          { name: post.title, url: postPath(urlConfig ?? {}, post.slug) },
        ],
        breadcrumbVariant: "blog",
        post,
        schemas,
      });
    }

    return reply.type("text/html").send(html);
  });

  app.post<{ Params: { slug: string }; Body: { password?: string } }>(
    "/api/posts/:slug/unlock",
    async (request, reply) => {
      const post = await prisma.post.findUnique({
        where: { type_slug: { type: "post", slug: request.params.slug } },
      });
      if (!post || post.status !== "published" || !post.password) {
        return reply.code(404).send({ error: "Không tìm thấy bài viết" });
      }

      if (request.body?.password !== post.password) {
        return reply.code(403).send({ error: "Mật khẩu không đúng" });
      }

      reply.setCookie(unlockCookieName(post.id), "1", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });

      return { success: true };
    },
  );
}
