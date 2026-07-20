import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { registerSession } from "./plugins/session.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerOAuthRoutes } from "./routes/admin/oauth.js";
import { registerPostRoutes } from "./routes/admin/posts.js";
import { registerPostsUiRoutes } from "./routes/admin/postsUi.js";
import { registerPageRoutes } from "./routes/admin/pages.js";
import { registerPagesUiRoutes } from "./routes/admin/pagesUi.js";
import { registerPostCategoryRoutes } from "./routes/admin/postCategories.js";
import { registerPostCategoriesUiRoutes } from "./routes/admin/postCategoriesUi.js";
import { registerMediaRoutes } from "./routes/admin/media.js";
import { registerMediaUiRoutes } from "./routes/admin/mediaUi.js";
import { registerOrderRoutes } from "./routes/admin/orders.js";
import { registerOrdersUiRoutes } from "./routes/admin/ordersUi.js";
import { registerProductRoutes } from "./routes/admin/products.js";
import { registerProductsUiRoutes } from "./routes/admin/productsUi.js";
import { registerRedirectRoutes } from "./routes/admin/redirects.js";
import { registerRedirectsUiRoutes } from "./routes/admin/redirectsUi.js";
import { registerReviewAdminRoutes } from "./routes/admin/reviews.js";
import { registerReviewsUiRoutes } from "./routes/admin/reviewsUi.js";
import { registerSettingsRoutes } from "./routes/admin/settings.js";
import { registerSettingsUiRoutes } from "./routes/admin/settingsUi.js";
import { registerUserRoutes } from "./routes/admin/users.js";
import { registerUsersUiRoutes } from "./routes/admin/usersUi.js";
import { registerAgentRoutes } from "./routes/admin/agents.js";
import { registerAgentsUiRoutes } from "./routes/admin/agentsUi.js";
import { registerBlogRoutes } from "./routes/public/blog.js";
import { registerPagesPublicRoutes } from "./routes/public/pages.js";
import { registerCartRoutes } from "./routes/public/cart.js";
import { registerProductsPublicRoutes } from "./routes/public/products.js";
import { registerProductsSyncRoutes } from "./routes/public/productsSync.js";
import { registerReviewRoutes } from "./routes/public/reviews.js";
import { registerSeoRoutes } from "./routes/public/seo.js";
import { startOrderRetryCron } from "./services/orderRetry.js";

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

// Chi bat duoc path KHONG khop bat ky route pattern nao (vd go sai URL hoan toan). "/blog/:slug"
// hay "/products/:id" van la route DA DANG KY nen luon "khop", moi khi slug/id khong ton tai thi
// handler cua chinh no phai TU tra Redirect roi moi 404 that (xem routes/public/blog.ts) - khong
// the dua vao handler nay cho case do. Quan tri tay bo sung o routes/admin/redirects.ts.
app.setNotFoundHandler(async (request, reply) => {
  const pathname = request.url.split("?")[0];
  const redirect = await prisma.redirect.findUnique({ where: { fromPath: pathname } });
  if (redirect) {
    return reply.code(redirect.statusCode).redirect(redirect.toPath);
  }
  return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
});

async function start(): Promise<void> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true }); // @fastify/static doi root ton tai luc dang ky

  await app.register(fastifyMultipart, { limits: { fileSize: 8 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: "/uploads/",
    decorateReply: false,
  });

  await registerSession(app);
  await registerOAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerPostRoutes(app);
  await registerPostsUiRoutes(app);
  await registerPageRoutes(app);
  await registerPagesUiRoutes(app);
  await registerPostCategoryRoutes(app);
  await registerPostCategoriesUiRoutes(app);
  await registerMediaRoutes(app);
  await registerMediaUiRoutes(app);
  await registerOrderRoutes(app);
  await registerOrdersUiRoutes(app);
  await registerProductRoutes(app);
  await registerProductsUiRoutes(app);
  await registerRedirectRoutes(app);
  await registerRedirectsUiRoutes(app);
  await registerReviewAdminRoutes(app);
  await registerReviewsUiRoutes(app);
  await registerSettingsRoutes(app);
  await registerSettingsUiRoutes(app);
  await registerUserRoutes(app);
  await registerUsersUiRoutes(app);
  await registerAgentRoutes(app);
  await registerAgentsUiRoutes(app);
  await registerBlogRoutes(app);
  await registerPagesPublicRoutes(app);
  await registerProductsPublicRoutes(app);
  await registerProductsSyncRoutes(app);
  await registerReviewRoutes(app);
  await registerCartRoutes(app);
  await registerSeoRoutes(app);

  startOrderRetryCron();

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
