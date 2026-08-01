import Fastify from "fastify";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerSession } from "../plugins/session.js";
import { configureSecurity } from "../plugins/security.js";

// Chan regression cho bug da fix: hook CSRF truoc day dang ky o "onRequest" (chay TRUOC khi
// Fastify parse body) trong khi getToken() doc req.body?._token khi khong co header - lam MOI
// request gui token qua body LUON LUON fail. Da doi sang "preHandler". Test nay dung route
// TOI GIAN (khong phai route admin that) de co lap dung hanh vi cua chinh hook CSRF, khong lien
// quan gi den nghiep vu admin.
async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  await registerSession(app);
  await configureSecurity(app);
  app.get("/test/csrf-token", async (_request, reply) => ({ token: await reply.generateCsrf() }));
  app.post("/test/protected", async () => ({ ok: true }));
  app.post("/api/test/exempt", async () => ({ ok: true }));
  app.post("/webhooks/test/exempt", async () => ({ ok: true }));
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });
  await app.ready();
  return app;
}

describe("CSRF protection", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a POST with no CSRF token at all", async () => {
    const res = await app.inject({ method: "POST", url: "/test/protected" });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a POST with a session cookie but a wrong CSRF token", async () => {
    const tokenRes = await app.inject({ method: "GET", url: "/test/csrf-token" });
    const cookie = tokenRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({ method: "POST", url: "/test/protected", headers: { cookie, "csrf-token": "wrong-token" } });
    expect(res.statusCode).toBe(403);
  });

  // Day chinh la hanh vi bi hong boi bug "onRequest" - token gui dung header (cach frontend that
  // dung, xem admin views) phai duoc chap nhan.
  it("accepts a POST with a valid CSRF token sent via header", async () => {
    const tokenRes = await app.inject({ method: "GET", url: "/test/csrf-token" });
    const cookie = tokenRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const token = tokenRes.json().token;

    const res = await app.inject({ method: "POST", url: "/test/protected", headers: { cookie, "csrf-token": token } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET requests never require a CSRF token", async () => {
    const res = await app.inject({ method: "GET", url: "/test/csrf-token" });
    expect(res.statusCode).toBe(200);
  });

  it("exempts /api/* routes from CSRF entirely (server-to-server, own token/api-key auth)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/test/exempt" });
    expect(res.statusCode).toBe(200);
  });

  it("exempts /webhooks/* routes from CSRF entirely (third-party signature auth)", async () => {
    const res = await app.inject({ method: "POST", url: "/webhooks/test/exempt" });
    expect(res.statusCode).toBe(200);
  });
});
