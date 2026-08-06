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

// Ban vendor tinh (khong tu dong cap nhat) cua https://cdn.tailwindcss.com, tai ve luu san trong
// themes/{slug}/assets/tailwind.js - tu theme khong con phai nhung <script src="https://
// cdn.tailwindcss.com"> nua (domain do PHAI whitelist rieng trong CSP script-src, moi lan quen la
// mat sach style + "tailwind is not defined", da gap loi that nhieu lan). Serve y het co che
// custom.js/custom.css o tren, KHONG dung sendAsset() chung vi file nay lon (~400-500KB), doc/tra
// ve dang Buffer thay vi ep utf-8 string cho nhanh hon mot chut.
async function sendTailwindVendor(reply: import("fastify").FastifyReply, slug: string) {
  if (!SLUG_PATTERN.test(slug)) {
    return reply.code(404).send();
  }
  const filePath = path.join(THEMES_ROOT, slug, "assets", "tailwind.js");
  const content = await fs.readFile(filePath).catch(() => null);
  if (content === null) {
    return reply.code(404).send();
  }
  return reply.type("application/javascript").send(content);
}

// Anh xem truoc theme (themes/{slug}/screenshot.png, KHONG nam trong assets/) - tuy chon, dung
// cho /admin/settings/theme hien preview. Binary (Buffer, KHONG doc utf-8 nhu sendAsset o tren -
// se hong file anh). File nao khong ton tai thi 404 binh thuong, UI tu an (xem
// GET /admin/api/themes tra kem "hasScreenshot").
async function sendScreenshot(reply: import("fastify").FastifyReply, slug: string) {
  if (!SLUG_PATTERN.test(slug)) {
    return reply.code(404).send();
  }
  const filePath = path.join(THEMES_ROOT, slug, "screenshot.png");
  const content = await fs.readFile(filePath).catch(() => null);
  if (content === null) {
    return reply.code(404).send();
  }
  return reply.type("image/png").send(content);
}

export async function registerThemeAssetsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/assets/custom.css", async (request, reply) => {
    return sendAsset(reply, request.params.slug, "custom.css", "text/css");
  });

  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/assets/tailwind-compiled.css", async (request, reply) => {
    return sendAsset(reply, request.params.slug, "tailwind-compiled.css", "text/css");
  });

  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/assets/custom.js", async (request, reply) => {
    return sendAsset(reply, request.params.slug, "custom.js", "application/javascript");
  });

  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/assets/tailwind.js", async (request, reply) => {
    return sendTailwindVendor(reply, request.params.slug);
  });

  app.get<{ Params: { slug: string } }>("/theme-assets/:slug/screenshot.png", async (request, reply) => {
    return sendScreenshot(reply, request.params.slug);
  });
}
