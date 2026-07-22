import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { registerSession } from "./plugins/session.js";
import { deleteOtherUserSessions } from "./services/sessionStore.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerOAuthRoutes } from "./routes/admin/oauth.js";
import { registerPostRoutes } from "./routes/admin/posts.js";
import { registerPostsAiRoutes } from "./routes/admin/postsAi.js";
import { registerPostsUiRoutes } from "./routes/admin/postsUi.js";
import { registerPageRoutes } from "./routes/admin/pages.js";
import { registerPagesUiRoutes } from "./routes/admin/pagesUi.js";
import { registerPostCategoryRoutes } from "./routes/admin/postCategories.js";
import { registerPostCategoriesUiRoutes } from "./routes/admin/postCategoriesUi.js";
import { registerProductCategoryRoutes } from "./routes/admin/productCategories.js";
import { registerProductCategoriesUiRoutes } from "./routes/admin/productCategoriesUi.js";
import { registerTopicRoutes } from "./routes/admin/topics.js";
import { registerTopicsUiRoutes } from "./routes/admin/topicsUi.js";
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
import { registerPaymentMethodRoutes } from "./routes/admin/paymentMethods.js";
import { registerShippingRuleRoutes } from "./routes/admin/shippingRules.js";
import { registerStoreRoutes } from "./routes/admin/stores.js";
import { registerFulfillmentMethodRoutes } from "./routes/admin/fulfillmentMethods.js";
import { registerCouponRoutes } from "./routes/admin/coupons.js";
import { registerUserRoutes } from "./routes/admin/users.js";
import { registerUsersUiRoutes } from "./routes/admin/usersUi.js";
import { registerAgentRoutes } from "./routes/admin/agents.js";
import { registerAgentsUiRoutes } from "./routes/admin/agentsUi.js";
import { registerPluginRoutes } from "./routes/admin/plugins.js";
import { registerMenuRoutes } from "./routes/admin/menus.js";
import { registerMenusUiRoutes } from "./routes/admin/menusUi.js";
import { registerThemeRoutes } from "./routes/admin/themes.js";
import { registerThemesUiRoutes } from "./routes/admin/themesUi.js";
import { registerThemeCustomizeRoutes } from "./routes/admin/themeCustomize.js";
import { registerThemeChatRoutes } from "./routes/admin/themeChat.js";
import { registerThemeEditorUiRoutes } from "./routes/admin/themeEditorUi.js";
import { registerThemePreviewRoutes } from "./routes/admin/themePreview.js";
import { registerThemeInlineEditRoutes } from "./routes/admin/themeInlineEdit.js";
import { registerSearchRoutes } from "./routes/admin/search.js";
import { registerPreviewRoutes } from "./routes/admin/preview.js";
import { registerHomeRoutes } from "./routes/public/home.js";
import { registerThemeAssetsRoutes } from "./routes/public/themeAssets.js";
import { renderNotFound } from "./services/notFoundPage.js";
import { registerBlogRoutes } from "./routes/public/blog.js";
import { registerPagesPublicRoutes } from "./routes/public/pages.js";
import { registerCartRoutes } from "./routes/public/cart.js";
import { registerVnpayRoutes } from "./routes/public/vnpay.js";
import { registerProvincesRoutes } from "./routes/public/provinces.js";
import { registerProductsPublicRoutes } from "./routes/public/products.js";
import { registerProductsSyncRoutes } from "./routes/public/productsSync.js";
import { registerReviewRoutes } from "./routes/public/reviews.js";
import { registerSeoRoutes } from "./routes/public/seo.js";
import { registerDynamicPrefixRoutes } from "./routes/public/dynamicPrefixes.js";
import { registerPublicSearchRoutes } from "./routes/public/search.js";
import { startOrderRetryCron } from "./services/orderRetry.js";
import { startPublishScheduler } from "./services/publishScheduler.js";

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

// Chan HAN TOAN chuc nang thuong mai (ca public lan admin) khi SiteConfig.siteType='blog' - vd
// admin lo chon nham "Blog" nhung link/API cu van con duoc share/index, hoac muon dam bao 1 site
// blog thuan khong the bi loi dung de ban hang. Prefix-match TRUOC roi moi query DB, de request
// blog binh thuong (post/trang chu) khong ton them 1 query moi lan.
const ECOMMERCE_PATH_PREFIXES = [
  "/products",
  "/cart",
  "/order-confirmation",
  "/payment/vnpay",
  "/api/cart",
  "/api/products",
  "/api/provinces",
  "/admin/products",
  "/admin/product-categories",
  "/admin/orders",
  "/admin/reviews",
  "/admin/settings/payment",
  "/admin/settings/shipping",
  "/admin/stores",
  "/admin/coupons",
  "/admin/api/products",
  "/admin/api/product-categories",
  "/admin/api/orders",
  "/admin/api/reviews",
  "/admin/api/payment-methods",
  "/admin/api/shipping-rules",
  "/admin/api/fulfillment-methods",
  "/admin/api/stores",
  "/admin/api/coupons",
];

function isEcommercePath(pathname: string): boolean {
  return ECOMMERCE_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

app.addHook("onRequest", async (request, reply) => {
  const pathname = request.url.split("?")[0];
  if (!isEcommercePath(pathname)) {
    return;
  }

  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  if (siteConfig?.siteType !== "blog") {
    return;
  }

  if (pathname.startsWith("/admin")) {
    return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
  }
  return reply.code(404).type("text/html").send(await renderNotFound());
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
  // /admin/* khong dung theme public - giu HTML don gian, tranh render nham giao dien site cho
  // nguoi dang thao tac trong khu quan tri.
  if (pathname.startsWith("/admin")) {
    return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy trang</h1>");
  }
  return reply.code(404).type("text/html").send(await renderNotFound());
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

  // Dev-only backdoor de test /admin ma khong can dang nhap that qua LeadBase OAuth - CHI bat
  // khi khong phai production. Set session qua chinh @fastify/session (Set-Cookie header that,
  // ky dung dinh dang), tranh phai tu tay ky/dan cookie qua DevTools console.
  if (!config.isProduction) {
    app.get("/dev/login-as-admin", async (request, reply) => {
      const user = await prisma.user.upsert({
        where: { leadbaseUserId: 999999 },
        create: { leadbaseUserId: 999999, name: "Local Admin", email: "local-admin@test.local", role: "admin", lastLoginAt: new Date() },
        update: { lastLoginAt: new Date() },
      });
      request.session.set("userId", user.leadbaseUserId);
      request.session.set("email", user.email);
      request.session.set("name", user.name);
      request.session.set("role", user.role);
      await request.session.save();
      await deleteOtherUserSessions(user.leadbaseUserId, request.session.sessionId);
      return reply.redirect("/admin");
    });
  }

  await registerOAuthRoutes(app);
  await registerAdminRoutes(app);
  await registerPostRoutes(app);
  await registerPostsAiRoutes(app);
  await registerPostsUiRoutes(app);
  await registerPageRoutes(app);
  await registerPagesUiRoutes(app);
  await registerPostCategoryRoutes(app);
  await registerPostCategoriesUiRoutes(app);
  await registerProductCategoryRoutes(app);
  await registerProductCategoriesUiRoutes(app);
  await registerTopicRoutes(app);
  await registerTopicsUiRoutes(app);
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
  await registerPaymentMethodRoutes(app);
  await registerShippingRuleRoutes(app);
  await registerStoreRoutes(app);
  await registerFulfillmentMethodRoutes(app);
  await registerCouponRoutes(app);
  await registerUserRoutes(app);
  await registerUsersUiRoutes(app);
  await registerAgentRoutes(app);
  await registerAgentsUiRoutes(app);
  await registerPluginRoutes(app);
  await registerMenuRoutes(app);
  await registerMenusUiRoutes(app);
  await registerThemeRoutes(app);
  await registerThemesUiRoutes(app);
  await registerThemeCustomizeRoutes(app);
  await registerThemeChatRoutes(app);
  await registerThemeEditorUiRoutes(app);
  await registerThemePreviewRoutes(app);
  await registerThemeInlineEditRoutes(app);
  await registerSearchRoutes(app);
  await registerPreviewRoutes(app);
  await registerHomeRoutes(app);
  await registerThemeAssetsRoutes(app);
  await registerBlogRoutes(app);
  await registerPagesPublicRoutes(app);
  await registerProductsPublicRoutes(app);
  await registerPublicSearchRoutes(app);
  await registerDynamicPrefixRoutes(app);
  await registerProductsSyncRoutes(app);
  await registerReviewRoutes(app);
  await registerCartRoutes(app);
  await registerVnpayRoutes(app);
  await registerProvincesRoutes(app);
  await registerSeoRoutes(app);

  startOrderRetryCron();
  startPublishScheduler();

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
