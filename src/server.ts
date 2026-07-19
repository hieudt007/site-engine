import Fastify from "fastify";
import { config } from "./config.js";
import { registerSession } from "./plugins/session.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerOAuthRoutes } from "./routes/admin/oauth.js";
import { registerPostRoutes } from "./routes/admin/posts.js";
import { registerPostsUiRoutes } from "./routes/admin/postsUi.js";
import { registerProductRoutes } from "./routes/admin/products.js";
import { registerProductsUiRoutes } from "./routes/admin/productsUi.js";
import { registerSettingsRoutes } from "./routes/admin/settings.js";
import { registerSettingsUiRoutes } from "./routes/admin/settingsUi.js";
import { registerBlogRoutes } from "./routes/public/blog.js";
import { registerProductsPublicRoutes } from "./routes/public/products.js";
import { registerProductsSyncRoutes } from "./routes/public/productsSync.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const app = Fastify({ logger: true, trustProxy: true });

// Giữ lại raw body (chuỗi thô trước khi JSON.parse) để verify chữ ký HMAC theo đúng byte đã ký
// (security.ts signSiteEngineRequest/verifySiteEngineRequest) — cần cho routes/public/
// productsSync.ts. Đăng ký GLOBAL 1 lần duy nhất (Fastify chỉ cho 1 parser/content-type), các
// route JSON khác (vd admin/posts.ts) không bị ảnh hưởng, chỉ có thêm request.rawBody.
app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  request.rawBody = body as string;
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.get("/health", async () => {
  return { status: "ok" };
});

async function start(): Promise<void> {
  await registerSession(app);
  await registerOAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerPostRoutes(app);
  await registerPostsUiRoutes(app);
  await registerProductRoutes(app);
  await registerProductsUiRoutes(app);
  await registerSettingsRoutes(app);
  await registerSettingsUiRoutes(app);
  await registerBlogRoutes(app);
  await registerProductsPublicRoutes(app);
  await registerProductsSyncRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
