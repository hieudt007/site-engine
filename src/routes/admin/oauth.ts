import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { buildAuthorizeUrl, exchangeCodeForUserInfo, generatePkce } from "../../services/leadbaseOAuth.js";
import { deleteOtherUserSessions } from "../../services/sessionStore.js";

const PENDING_COOKIE = "oauth_pending";
const PENDING_TTL_SECONDS = 5 * 60; // đủ thời gian tenant duyệt consent screen bên LeadBase

interface PendingOAuth {
  state: string;
  codeVerifier: string;
}

function redirectUriFor(request: { protocol: string; hostname: string }): string {
  return `${request.protocol}://${request.hostname}/admin/oauth/callback`;
}

// Đăng nhập admin qua OAuth THẬT của LeadBase (Laravel Passport, PKCE public client) — y hệt
// luồng AI/MCP đang xác thực vào LeadBase, KHÔNG còn mật khẩu riêng (system_design.md §5.1).
export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/login", async (request, reply) => {
    const pkce = generatePkce();
    const pending: PendingOAuth = { state: pkce.state, codeVerifier: pkce.codeVerifier };

    reply.setCookie(PENDING_COOKIE, JSON.stringify(pending), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: PENDING_TTL_SECONDS,
    });

    const authorizeUrl = buildAuthorizeUrl(redirectUriFor(request), pkce);
    return reply.redirect(authorizeUrl);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/admin/oauth/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      const rawPending = request.cookies[PENDING_COOKIE];
      reply.clearCookie(PENDING_COOKIE, { path: "/" });

      if (error) {
        return reply.code(400).send({ error: `LeadBase từ chối: ${error}` });
      }
      if (!code || !state || !rawPending) {
        return reply.code(400).send({ error: "Thiếu code/state hoặc phiên OAuth đã hết hạn" });
      }

      let pending: PendingOAuth;
      try {
        pending = JSON.parse(rawPending);
      } catch {
        return reply.code(400).send({ error: "Phiên OAuth không hợp lệ" });
      }

      if (pending.state !== state) {
        return reply.code(401).send({ error: "State không khớp — có thể bị CSRF" });
      }

      try {
        const userInfo = await exchangeCodeForUserInfo(code, pending.codeVerifier, redirectUriFor(request));

        const user = await prisma.user.upsert({
          where: { leadbaseUserId: userInfo.id },
          update: { name: userInfo.name, email: userInfo.email, role: userInfo.role, lastLoginAt: new Date() },
          create: {
            leadbaseUserId: userInfo.id,
            name: userInfo.name,
            email: userInfo.email,
            role: userInfo.role,
            lastLoginAt: new Date(),
          },
        });

        request.session.set("userId", user.leadbaseUserId);
        request.session.set("email", user.email);
        request.session.set("name", user.name);
        request.session.set("role", user.role);

        // 1 tai khoan chi dang nhap 1 thiet bi (giong lead-base) - phai save() TRUOC de co
        // sessionId that, roi moi xoa cac session KHAC cung userId (khong tu xoa chinh minh).
        await request.session.save();
        await deleteOtherUserSessions(user.leadbaseUserId, request.session.sessionId);
      } catch (err) {
        request.log.error(err);
        return reply.code(502).send({ error: "Không xác thực được với LeadBase" });
      }

      return reply.redirect("/admin");
    },
  );

  app.post("/admin/logout", async (request, reply) => {
    await request.session.destroy();
    return { success: true };
  });
}
