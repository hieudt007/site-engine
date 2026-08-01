import crypto from "node:crypto";
import Fastify from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { config as appConfig } from "../config.js";
import { verifyHmac } from "../routes/public/customerChat.js";
import { prisma } from "../db.js";

// Luong chat CSKH cong khai (khach vang lai, khong dang nhap) - HMAC la lop xac thuc DUY NHAT
// cho sessionId, phia sau con co gioi han 30 tin/ngay va tu-ban session sau 3 loi. verifyHmac
// truoc day so sanh bang "===" (khong constant-time) - da fix sang crypto.timingSafeEqual.
describe("verifyHmac", () => {
  function sign(sessionId: string): string {
    return crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
  }

  it("accepts a correctly signed sessionId", () => {
    expect(verifyHmac("session-abc", sign("session-abc"))).toBe(true);
  });

  it("rejects a token signed for a different sessionId", () => {
    expect(verifyHmac("session-abc", sign("session-xyz"))).toBe(false);
  });

  it("rejects garbage input without throwing", () => {
    expect(verifyHmac("session-abc", "not-a-valid-hex-token")).toBe(false);
    expect(verifyHmac("session-abc", "")).toBe(false);
  });

  // timingSafeEqual nem loi neu 2 buffer khac do dai - phai tu kiem tra do dai TRUOC, khong duoc
  // de throw ro ri ra ngoai (se thanh 500 thay vi tra ve false/403 gon gang).
  it("does not throw when the provided token has a different length than expected", () => {
    expect(() => verifyHmac("session-abc", "short")).not.toThrow();
    expect(verifyHmac("session-abc", "short")).toBe(false);
  });
});

describe("POST /api/customer-chat", () => {
  const suffix = Date.now();
  let app: any;
  let agentId: string;

  vi.mock("../agents/core/BaseAgent.js", () => ({
    BaseAgent: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({ messages: ["Xin chào, mình có thể giúp gì cho bạn?"] }),
    })),
  }));

  beforeAll(async () => {
    const agent = await prisma.agent.create({
      data: { key: `cskh-test-${suffix}`, name: "CSKH Test", provider: "openai", model: "gpt-4", systemPrompt: "x", isActive: true },
    });
    agentId = agent.id;
    await prisma.siteConfig.upsert({
      where: { id: "singleton" },
      update: { cskhAgentId: agentId, turnstileSecretKey: null },
      create: { id: "singleton", domain: "localhost", siteName: "Test Site", cskhAgentId: agentId },
    });

    const { registerCustomerChatPublicRoutes } = await import("../routes/public/customerChat.js");
    app = Fastify({ logger: false, trustProxy: true });
    await app.register(fastifyRateLimit, { global: false });
    await registerCustomerChatPublicRoutes(app);
    app.setErrorHandler((error: any, _request: any, reply: any) => {
      if (error.statusCode) return reply.code(error.statusCode).send({ error: error.message });
      return reply.code(500).send({ error: "Internal Server Error" });
    });
    await app.ready();
  });

  afterAll(async () => {
    await prisma.customerChatMessage.deleteMany({ where: { agentKey: `cskh-test-${suffix}` } }).catch(() => {});
    await prisma.siteConfig.update({ where: { id: "singleton" }, data: { cskhAgentId: null } }).catch(() => {});
    await prisma.agent.delete({ where: { id: agentId } }).catch(() => {});
    await app.close();
  });

  function sign(sessionId: string): string {
    return crypto.createHmac("sha256", appConfig.siteEngineSecret).update(sessionId).digest("hex");
  }

  it("rejects a request with an invalid HMAC token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/customer-chat",
      payload: { agentKey: `cskh-test-${suffix}`, sessionId: "s1", hmacToken: "wrong", message: "hi" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("accepts a valid HMAC token and streams a response via the mocked agent", async () => {
    const sessionId = `session-${suffix}-happy`;
    const res = await app.inject({
      method: "POST",
      url: "/api/customer-chat",
      payload: { agentKey: `cskh-test-${suffix}`, sessionId, hmacToken: sign(sessionId), message: "Xin chào" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Xin chào, mình có thể giúp gì cho bạn?");

    const saved = await prisma.customerChatMessage.findMany({ where: { sessionId }, orderBy: { id: "asc" } });
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  // Chan regression: gioi han 30 tin/ngay chong spam/DoS chi phi AI - session da gui du 30 tin
  // PHAI bi chan o request thu 31, khong duoc goi AI them.
  it("blocks a session that has already sent 30 messages today", async () => {
    const sessionId = `session-${suffix}-limit`;
    await prisma.customerChatMessage.createMany({
      data: Array.from({ length: 30 }, () => ({
        sessionId,
        agentKey: `cskh-test-${suffix}`,
        role: "user",
        message: "tin nhan cu",
      })),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/customer-chat",
      payload: { agentKey: `cskh-test-${suffix}`, sessionId, hmacToken: sign(sessionId), message: "tin thu 31" },
    });
    expect(res.statusCode).toBe(429);
  });

  // Chan regression: sau 3 loi (role="error") trong 1 session, tu dong ngung phuc vu (chong
  // spam/tan cong lien tuc gay loi AI lien tuc).
  it("bans a session after more than 2 error records", async () => {
    const sessionId = `session-${suffix}-banned`;
    await prisma.customerChatMessage.createMany({
      data: Array.from({ length: 3 }, () => ({
        sessionId,
        agentKey: `cskh-test-${suffix}`,
        role: "error",
        message: "loi cu",
      })),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/customer-chat",
      payload: { agentKey: `cskh-test-${suffix}`, sessionId, hmacToken: sign(sessionId), message: "hi" },
    });
    expect(res.statusCode).toBe(403);
  });
});
