import Fastify from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerSession } from "../plugins/session.js";
import { configureSecurity } from "../plugins/security.js";
import { registerReviewRoutes } from "../routes/public/reviews.js";
import { prisma } from "../db.js";

// POST /products/:id/reviews - luon tao o "pending" (chan spam noi dung hien cong khai), nhung
// truoc day KHONG rate-limit (co the lam phinh hang cho duyet vo han). Test ca 2: hanh vi nghiep
// vu (pending, 404 san pham chua publish) VA rate-limit vua them.
async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  await registerSession(app);
  await configureSecurity(app);
  // config.rateLimit tren route CHI co hieu luc neu plugin nay da duoc dang ky - giong dung
  // server.ts that (global: false, tung route tu khai bao rateLimit rieng).
  await app.register(fastifyRateLimit, { global: false });
  await registerReviewRoutes(app);
  // Route phu tro CHI danh cho test: lay CSRF token + cookie truoc khi POST, giong dung cach
  // frontend that lam (khong bypass CSRF).
  app.get("/test/csrf", async (_request, reply) => {
    const token = await reply.generateCsrf();
    return { token };
  });
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });
  await app.ready();
  return app;
}

async function csrfHeaders(app: Awaited<ReturnType<typeof buildTestApp>>): Promise<Record<string, string>> {
  const res = await app.inject({ method: "GET", url: "/test/csrf" });
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { cookie, "csrf-token": res.json().token };
}

describe("POST /products/:id/reviews", () => {
  const suffix = Date.now();
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let headers: Record<string, string>;
  let publishedProductId: string;
  let draftProductId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    headers = await csrfHeaders(app);

    const published = await prisma.productCache.create({
      data: { leadbaseProductId: `lb-${suffix}-1`, price: 100000, leadbaseStatus: "active", name: "Published Product", status: "published" },
    });
    publishedProductId = published.id;

    const draft = await prisma.productCache.create({
      data: { leadbaseProductId: `lb-${suffix}-2`, price: 100000, leadbaseStatus: "active", name: "Draft Product", status: "draft" },
    });
    draftProductId = draft.id;
  });

  afterAll(async () => {
    await prisma.productReview.deleteMany({ where: { productCacheId: { in: [publishedProductId, draftProductId] } } }).catch(() => {});
    await prisma.productCache.delete({ where: { id: publishedProductId } }).catch(() => {});
    await prisma.productCache.delete({ where: { id: draftProductId } }).catch(() => {});
    await app.close();
  });

  it("creates a review with status=pending for a published product", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/products/${publishedProductId}/reviews`,
      headers,
      payload: { customerName: "Nguyen Van A", rating: 5, comment: "Sản phẩm tốt" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().review.status).toBe("pending");

    const stored = await prisma.productReview.findUnique({ where: { id: res.json().review.id } });
    expect(stored?.status).toBe("pending");
  });

  it("rejects an invalid rating (out of 1-5 range)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/products/${publishedProductId}/reviews`,
      headers,
      payload: { customerName: "Test", rating: 10 },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 404 for a product that isn't published (draft)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/products/${draftProductId}/reviews`,
      headers,
      payload: { customerName: "Test", rating: 5 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for a non-existent product id", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/products/does-not-exist/reviews`,
      headers,
      payload: { customerName: "Test", rating: 5 },
    });
    expect(res.statusCode).toBe(404);
  });

  // Chan regression cho lo hong da vá: route nay truoc day KHONG rate-limit, ai cung co the lam
  // phinh hang cho duyet vo han. Gio gioi han 10 request/phut.
  it("rate-limits after 10 requests within 1 minute", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: "POST",
        url: `/products/${publishedProductId}/reviews`,
        headers,
        payload: { customerName: `Rate Limit Probe ${i}`, rating: 5 },
      });
      lastStatus = res.statusCode;
    }
    expect(lastStatus).toBe(429);
  }, 20_000);
});
