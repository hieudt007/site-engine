import Fastify from "fastify";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { registerSession } from "../plugins/session.js";
import { config } from "../config.js";
import { prisma } from "../db.js";

// Dang nhap admin QUA OAuth THAT cua LeadBase (Passport, PKCE public client) - khong con mat khau
// rieng. Mock exchangeCodeForUserInfo (goi mang that ve LeadBase) de test duoc callback ma khong
// can server LeadBase that. "state" dong vai tro chinh chong CSRF cho luong nay (khong phai token
// rieng) - phai khop giua luc goi /admin/login va luc callback ve.
vi.mock("../services/leadbaseOAuth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/leadbaseOAuth.js")>();
  return { ...actual, exchangeCodeForUserInfo: vi.fn() };
});

const { exchangeCodeForUserInfo } = await import("../services/leadbaseOAuth.js");
const { registerOAuthRoutes } = await import("../routes/admin/oauth.js");

async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  await registerSession(app);
  await registerOAuthRoutes(app);
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });
  await app.ready();
  return app;
}

describe("admin OAuth login", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const leadbaseUserId = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: leadbaseUserId } }).catch(() => {});
    await prisma.user.delete({ where: { leadbaseUserId } }).catch(() => {});
    await app.close();
  });

  it("GET /admin/login redirects to LeadBase's real authorize URL with a fresh PKCE state", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/login" });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location.startsWith(`${config.leadbaseApiUrl}/oauth/authorize`)).toBe(true);
    expect(location).toContain(`client_id=${config.leadbaseOauthClientId}`);
    expect(res.cookies.some((c) => c.name === "oauth_pending")).toBe(true);
  });

  it("GET /admin/oauth/callback rejects when LeadBase reports an error", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/oauth/callback?error=access_denied" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /admin/oauth/callback rejects when there's no pending cookie (session expired/CSRF)", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/oauth/callback?code=abc&state=xyz" });
    expect(res.statusCode).toBe(400);
  });

  // Chan CSRF: "state" tra ve tu LeadBase PHAI khop dung state da luu trong cookie luc /admin/login
  // - neu khac, day co the la 1 callback bi ke tan cong gia mao chen vao.
  it("GET /admin/oauth/callback rejects when state doesn't match the pending cookie", async () => {
    const loginRes = await app.inject({ method: "GET", url: "/admin/login" });
    const cookie = loginRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await app.inject({ method: "GET", url: "/admin/oauth/callback?code=abc&state=wrong-state", headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it("completes login on a valid callback: exchanges code, creates/updates the user, and establishes a session", async () => {
    vi.mocked(exchangeCodeForUserInfo).mockResolvedValue({
      id: leadbaseUserId,
      name: "Test Admin",
      email: `test-admin-${leadbaseUserId}@example.com`,
      role: "admin",
    });

    const loginRes = await app.inject({ method: "GET", url: "/admin/login" });
    const cookie = loginRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const location = loginRes.headers.location as string;
    const state = new URL(location).searchParams.get("state")!;

    const res = await app.inject({ method: "GET", url: `/admin/oauth/callback?code=real-code&state=${state}`, headers: { cookie } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/admin");
    expect(exchangeCodeForUserInfo).toHaveBeenCalledWith("real-code", expect.any(String), expect.stringContaining("/admin/oauth/callback"));

    const user = await prisma.user.findUnique({ where: { leadbaseUserId } });
    expect(user).toMatchObject({ name: "Test Admin", role: "admin" });

    // Session PHAI duoc thiet lap that (khong chi redirect) - kiem tra qua cookie session tra ve.
    expect(res.cookies.some((c) => c.name === "site_engine_session")).toBe(true);
  });

  it("returns 502 when LeadBase's token/userinfo exchange itself fails", async () => {
    vi.mocked(exchangeCodeForUserInfo).mockRejectedValue(new Error("LeadBase down"));

    const loginRes = await app.inject({ method: "GET", url: "/admin/login" });
    const cookie = loginRes.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const state = new URL(loginRes.headers.location as string).searchParams.get("state")!;

    const res = await app.inject({ method: "GET", url: `/admin/oauth/callback?code=bad&state=${state}`, headers: { cookie } });
    expect(res.statusCode).toBe(502);
  });
});
