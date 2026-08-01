import Fastify from "fastify";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "../config.js";
import { signSiteEngineRequest } from "../security.js";
import { registerProductsSyncRoutes } from "../routes/public/productsSync.js";
import { prisma } from "../db.js";

// POST /api/products/sync - LeadBase chu dong day moi khi san pham doi (1 trong 3 API HTTP that
// duy nhat cua toan he thong). "create" tao moi (status luon 'draft'), "update" CHI duoc dung
// price/stock/status - KHONG duoc dam vao name/description/imageUrls (website tu quan). Can dang
// ky lai chinh xac content-type parser cua server.ts (giu rawBody) vi chu ky HMAC ky tren BYTE
// THO, khong phai object da JSON.parse.
async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request: any, body, done) => {
    request.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  await registerProductsSyncRoutes(app);
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });
  await app.ready();
  return app;
}

function signedHeaders(body: unknown): Record<string, string> {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-site-engine-timestamp": timestamp,
    "x-site-engine-signature-256": signSiteEngineRequest(config.siteEngineSecret, timestamp, raw),
  };
}

describe("POST /api/products/sync", () => {
  const suffix = Date.now();
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const leadbaseProductId = `lb-sync-${suffix}`;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await prisma.productCache.deleteMany({ where: { leadbaseProductId } }).catch(() => {});
    await app.close();
  });

  it("rejects a request with no signature headers at all", async () => {
    const res = await app.inject({ method: "POST", url: "/api/products/sync", payload: { action: "create" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with an invalid signature", async () => {
    const body = { action: "create", leadbaseProductId, name: "x", price: 1000, status: "selling" };
    const res = await app.inject({
      method: "POST",
      url: "/api/products/sync",
      headers: { "x-site-engine-timestamp": String(Math.floor(Date.now() / 1000)), "x-site-engine-signature-256": "sha256=wrong" },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a new ProductCache in 'draft' status on action=create", async () => {
    const body = { action: "create", leadbaseProductId, name: "Test Sync Product", price: 200000, status: "selling" };
    const res = await app.inject({ method: "POST", url: "/api/products/sync", headers: signedHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });

    const created = await prisma.productCache.findUnique({ where: { leadbaseProductId } });
    expect(created).toMatchObject({ name: "Test Sync Product", status: "draft", leadbaseStatus: "selling" });
    expect(Number(created!.price)).toBe(200000);
  }, 20_000);

  // Chan regression: "update" CHI duoc doi price/stock/status - KHONG duoc dam vao noi dung website
  // tu quan (name o day khong nam trong syncSchema cua action update nen khong the gui len duoc,
  // xac nhan gia tri name CU van con nguyen sau update).
  it("action=update only touches price/stock/status, never the website-owned name", async () => {
    const body = { action: "update", leadbaseProductId, price: 250000, stock: 5, status: "out_of_stock" };
    const res = await app.inject({ method: "POST", url: "/api/products/sync", headers: signedHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);

    const updated = await prisma.productCache.findUnique({ where: { leadbaseProductId } });
    expect(Number(updated!.price)).toBe(250000);
    expect(updated!.stock).toBe(5);
    expect(updated!.leadbaseStatus).toBe("out_of_stock");
    expect(updated!.name).toBe("Test Sync Product"); // khong bi dam de
  }, 20_000);

  it("returns 404 for action=update on a product that was never created", async () => {
    const body = { action: "update", leadbaseProductId: "never-existed", price: 1000, status: "selling" };
    const res = await app.inject({ method: "POST", url: "/api/products/sync", headers: signedHeaders(body), payload: body });
    expect(res.statusCode).toBe(404);
  });
});
