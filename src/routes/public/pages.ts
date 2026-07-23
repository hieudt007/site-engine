import { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { readSeo } from "../../services/seoJson.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { pagePath } from "../../services/urlPaths.js";

function queryString(url: string): string {
  const index = url.indexOf("?");
  return index >= 0 ? url.slice(index) : "";
}

async function siteUrlConfig() {
  const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  return config as { postSlugPrefix?: string | null; pageSlugPrefix?: string | null; productSlugPrefix?: string | null } | null;
}

export async function renderPage(slug: string, reply: FastifyReply) {
  const page = await prisma.post.findUnique({ where: { type_slug: { type: "page", slug } } });
  if (!page || page.status !== "published") {
    return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy trang"));
  }

  const seo = readSeo(page.seo);
  const urlConfig = await siteUrlConfig();
  const pageData = {
    pageTitle: seo.metaTitle || page.title,
    metaDescription: seo.metaDescription || page.excerpt || undefined,
    noindex: seo.noindex,
  };

  if (page.layoutMode === "landing") {
    return reply.type("text/html").send(await renderPublic("landing", { ...pageData, rawHtml: page.body }));
  }
  if (page.layoutMode === "custom") {
    return reply.type("text/html").send(await renderPublic("custom-content", { ...pageData, rawHtml: page.body }));
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

export async function registerPagesPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/p/:slug", async (request, reply) => {
    const target = pagePath((await siteUrlConfig()) ?? {}, request.params.slug);
    if (target !== `/p/${request.params.slug}`) {
      return reply.redirect(target + queryString(request.url));
    }
    return renderPage(request.params.slug, reply);
  });

  app.get<{ Params: { slug: string } }>("/trang/:slug", async (request, reply) => {
    return reply.redirect(pagePath((await siteUrlConfig()) ?? {}, request.params.slug) + queryString(request.url));
  });
}
