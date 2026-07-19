import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { verifySsoToken } from "../security.js";

// Chống replay (system_design.md §5.1) — token sống rất ngắn (LeadBase phát exp = now + 60s)
// nên lưu tạm trong bộ nhớ là đủ, không cần bảng DB riêng (mất khi restart, chấp nhận được vì
// token cũ đã hết hạn từ lâu trước khi process restart trong thực tế).
const usedTokens = new Map<string, number>(); // sha256(token) -> exp (unix seconds)

function pruneUsedTokens(): void {
  const now = Date.now() / 1000;
  for (const [hash, exp] of usedTokens) {
    if (exp < now) {
      usedTokens.delete(hash);
    }
  }
}

export async function registerSsoRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { token?: string } }>("/sso", async (request, reply) => {
    const token = request.query.token;
    if (!token) {
      return reply.code(400).send({ error: "Missing token" });
    }

    const payload = verifySsoToken(config.siteEngineSecret, token);
    if (!payload) {
      return reply.code(401).send({ error: "Invalid or expired token" });
    }

    pruneUsedTokens();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (usedTokens.has(tokenHash)) {
      return reply.code(401).send({ error: "Token already used" });
    }
    usedTokens.set(tokenHash, payload.exp);

    request.session.set("userId", payload.userId);
    request.session.set("userName", payload.userName);
    request.session.set("permissions", payload.permissions);

    return reply.redirect("/admin");
  });
}
