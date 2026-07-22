import { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../../db.js";
import { pagePrefix, postPrefix, productPrefix } from "../../services/urlPaths.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { renderPage } from "./pages.js";
import { renderPostBySlug, renderPostCategoryBySlug, renderTopicBySlug } from "./blog.js";

type DynamicNotFoundResult =
  | { redirect: { statusCode: number; toPath: string } }
  | { html: string };

async function siteUrlConfig() {
  const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  return config as { postSlugPrefix?: string | null; pageSlugPrefix?: string | null; productSlugPrefix?: string | null } | null;
}

function queryString(url: string): string {
  const index = url.indexOf("?");
  return index >= 0 ? url.slice(index) : "";
}

async function renderDynamicNotFound(request: FastifyRequest, message = "Không tìm thấy trang"): Promise<DynamicNotFoundResult> {
  const pathname = request.url.split("?")[0];
  const redirect = await prisma.redirect.findUnique({ where: { fromPath: pathname } });
  if (redirect) return { redirect };
  return { html: await renderNotFound(message) };
}

export async function registerDynamicPrefixRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { prefix: string; slug: string }; Querystring: { page?: string } }>("/:prefix/danh-muc/:slug", async (request, reply) => {
    const config = (await siteUrlConfig()) ?? {};
    if (request.params.prefix === postPrefix(config)) {
      return renderPostCategoryBySlug(request.params.slug, request, reply);
    }
    const notFound = await renderDynamicNotFound(request, "Không tìm thấy danh mục");
    if ("redirect" in notFound) return reply.code(notFound.redirect.statusCode).redirect(notFound.redirect.toPath);
    return reply.code(404).type("text/html").send(notFound.html);
  });

  app.get<{ Params: { prefix: string; slug: string }; Querystring: { page?: string } }>("/:prefix/chu-de/:slug", async (request, reply) => {
    const config = (await siteUrlConfig()) ?? {};
    if (request.params.prefix === postPrefix(config)) {
      return renderTopicBySlug(request.params.slug, request, reply);
    }
    const notFound = await renderDynamicNotFound(request, "Không tìm thấy chủ đề");
    if ("redirect" in notFound) return reply.code(notFound.redirect.statusCode).redirect(notFound.redirect.toPath);
    return reply.code(404).type("text/html").send(notFound.html);
  });

  app.get<{ Params: { prefix: string; slug: string } }>("/:prefix/:slug", async (request, reply) => {
    const config = (await siteUrlConfig()) ?? {};
    if (request.params.prefix === postPrefix(config)) {
      return renderPostBySlug(request.params.slug, request, reply);
    }
    if (request.params.prefix === pagePrefix(config)) {
      return renderPage(request.params.slug, reply);
    }
    if (request.params.prefix === productPrefix(config)) {
      return reply.redirect(`/product/${request.params.slug}${queryString(request.url)}`);
    }

    const notFound = await renderDynamicNotFound(request);
    if ("redirect" in notFound) return reply.code(notFound.redirect.statusCode).redirect(notFound.redirect.toPath);
    return reply.code(404).type("text/html").send(notFound.html);
  });

  app.get<{ Params: { prefix: string; slug: string } }>("/:prefix/:slug/unlock", async (request, reply) => {
    const config = (await siteUrlConfig()) ?? {};
    if (request.params.prefix === postPrefix(config)) {
      return reply.redirect(`/${request.params.slug}/unlock${queryString(request.url)}`);
    }
    const notFound = await renderDynamicNotFound(request, "Không tìm thấy bài viết");
    if ("redirect" in notFound) return reply.code(notFound.redirect.statusCode).redirect(notFound.redirect.toPath);
    return reply.code(404).type("text/html").send(notFound.html);
  });
}
