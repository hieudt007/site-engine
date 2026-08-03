import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import fastifyCsrfProtection from "@fastify/csrf-protection";
import { config } from "../config.js";
import { CacheService } from "../services/CacheService.js";
import { extractScriptDomains } from "../utils/cspParser.js";
import { requireRole } from "./requireRole.js";

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
              "https://www.googletagmanager.com",
              "https://www.google-analytics.com",
              "https://connect.facebook.net",
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

  // 1.5. Dynamic CSP cho external scripts từ SiteConfig
  app.addHook("onSend", async (request, reply, payload) => {
    const contentType = reply.getHeader("content-type");
    if (typeof contentType === "string" && contentType.includes("text/html")) {
      const csp = reply.getHeader("content-security-policy");
      if (typeof csp === "string") {
        try {
          const site = await CacheService.getSiteConfig();
          const customDomains = [
            ...extractScriptDomains(site.customHeadScript),
            ...extractScriptDomains(site.customFooterScript),
          ];

          if (customDomains.length > 0) {
            const uniqueDomains = Array.from(new Set(customDomains)).join(" ");
            let newCsp = csp;
            if (newCsp.includes("script-src ")) {
              newCsp = newCsp.replace("script-src ", `script-src ${uniqueDomains} `);
            }
            if (newCsp.includes("connect-src ")) {
              newCsp = newCsp.replace("connect-src ", `connect-src ${uniqueDomains} `);
            }
            // frame-src may also be needed for chat widgets
            if (newCsp.includes("frame-src ")) {
              newCsp = newCsp.replace("frame-src ", `frame-src ${uniqueDomains} `);
            }
            reply.header("content-security-policy", newCsp);
          }
        } catch (e) {
          // Ignore cache/db error to not break the page
          app.log.error(e, "Error injecting dynamic CSP");
        }
      }
    }
    return payload;
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

  // views/admin/*.liquid CHUA TUNG gan CSRF token vao fetch() nao ca (khong tim thay 1 dong
  // nao trong toan bo views/assets) - moi POST/PUT/PATCH/DELETE vao /admin/* deu thieu token,
  // luon nem "Missing csrf secret" du session/CSRF da dang ky dung thu tu. Thay vi sua tung 1
  // trong ~40 file route/template (moi trang goi renderAdmin() rieng), them 1 endpoint GET de
  // layout.liquid tu fetch token 1 lan roi patch window.fetch toan cuc - ap dung cho MOI trang
  // admin cung luc, khong dong vao renderAdmin()/cac route rieng le.
  app.get("/admin/csrf-token", { preHandler: requireRole("edit") }, async (_request, reply) => {
    const token = await reply.generateCsrf();
    return { token };
  });

  // QUAN TRONG: PHAI dung "preHandler" (KHONG duoc "onRequest") - getToken() o tren doc
  // req.body?._token/_csrf khi khong co header. "onRequest" chay TRUOC khi Fastify parse body
  // (request.body luon undefined o giai doan do) nen fallback nay se LUON LUON fail cho bat ky
  // form nao gui token qua body thay vi header - dung theo README cua @fastify/csrf-protection.
  // Hien tai chua co <form> HTML that nao trong views/ (tat ca deu fetch() gui token qua header)
  // nen chua co trieu chung, nhung day la dung bug da gap va sua 2 lan o lead-base-node/
  // chatbot-lite - sua truoc de khong thanh qua bom hen gio.
  app.addHook("preHandler", (request: FastifyRequest, reply: FastifyReply, done) => {
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
