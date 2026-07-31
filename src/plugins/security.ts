import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import fastifyCsrfProtection from "@fastify/csrf-protection";
import { config } from "../config.js";

export async function configureSecurity(app: FastifyInstance): Promise<void> {
  // 1. Helmet: Content-Security-Policy
  await app.register(helmet, {
    contentSecurityPolicy: config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
              "'self'",
              "https://static.cloudflareinsights.com",
              "https://challenges.cloudflare.com",
              "'unsafe-inline'", // Site builder/CMS thường sinh CSS/JS inline
              "'unsafe-eval'",
            ],
            frameSrc: ["'self'", "https://challenges.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https:", "wss:"],
            fontSrc: ["'self'", "data:", "https:", "https://fonts.gstatic.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Cho phép load ảnh từ CDN
  });

  // 2. CSRF Protection
  await app.register(fastifyCsrfProtection, {
    sessionPlugin: "@fastify/session",
    getToken: (req) => {
      return (
        (req.headers["csrf-token"] as string) ||
        (req.headers["xsrf-token"] as string) ||
        (req.headers["x-csrf-token"] as string) ||
        (req.headers["x-xsrf-token"] as string) ||
        (req.body as any)?._token ||
        (req.body as any)?._csrf
      );
    },
  });

  // Global onRequest hook để kiểm tra CSRF token cho các API POST/PUT/DELETE
  // Ngoại lệ: Webhook từ bên thứ 3 hoặc API khách hàng
  app.addHook("onRequest", (request: FastifyRequest, reply: FastifyReply, done) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return done();
    
    const pathname = request.url.split("?")[0];
    // Bỏ qua CSRF cho webhook và API (thường gọi từ LeadBase Node bằng token/api-key riêng)
    if (pathname.startsWith("/webhooks/") || pathname.startsWith("/api/")) {
      return done(); 
    }

    // app.csrfProtection sẽ tự gọi done() hoặc ném lỗi nếu CSRF token sai
    app.csrfProtection(request, reply, done);
  });
}
