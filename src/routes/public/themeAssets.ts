import fs from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";

const THEMES_ROOT = path.join(process.cwd(), "themes");

// CSS/JS tuy bien do AI sinh cho tung theme (khac uploads/ static mount — day CHI serve dung
// assets/custom.css|js, KHONG expose ca thu muc themes/ ra public nhu vay se lo luon source
// .liquid). slug validate bang regex - khop dung quy uoc slug theme (routes/admin/themeCustomize.ts).
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function sendAsset(reply: import("fastify").FastifyReply, slug: string, filename: string, contentType: string) {
  if (!SLUG_PATTERN.test(slug)) {
    return reply.code(404).send();
  }
  const filePath = path.join(THEMES_ROOT, slug, "assets", filename);
  const content = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (content === null) {
    return reply.code(404).send();
  }
  return reply.type(contentType).send(content);
}

export async function registerThemeAssetsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/assets/custom.css", async (request, reply) => {
    return sendAsset(reply, request.params.slug, "custom.css", "text/css");
  });

  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/assets/custom.js", async (request, reply) => {
    return sendAsset(reply, request.params.slug, "custom.js", "application/javascript");
  });
}
