import Fastify, { type FastifyInstance } from "fastify";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerSession } from "../plugins/session.js";
import { configureSecurity } from "../plugins/security.js";

// Khong co 1 global auth guard hook nao chan chung "/admin/*" - MOI route tu gan
// { preHandler: requireRole(...) } rieng (xem plugins/requireRole.ts). Rui ro that: 1 route nao do
// lo QUEN gan requireRole se cho phep bat ky ai KHONG dang nhap goi duoc API admin. Test nay dang
// ky TOAN BO ~50 module route admin that (dung dung file server.ts dung), thu thap moi route qua
// hook "onRoute", roi goi khong session cho tung route va bat buoc phai bi tu choi (401/403/redirect
// ve login) - khong duoc tra ve 200 hay bat ky response "thanh cong" nao khac.
//
// requireRole() (plugins/requireRole.ts) hop dong chinh xac:
//   - Khong co session: "/admin/*" (KHONG phai "/admin/api/*") -> redirect 302 ve /admin/login
//                        "/admin/api/*" -> 401 JSON
//   - Co session nhung thieu quyen -> 403 JSON
// Test nay chi mo phong truong hop "khong co session" (truong hop de bi quen chan nhat).

const PUBLIC_ADMIN_ROUTES = new Set([
  "GET /admin/login",
  "GET /admin/oauth/callback",
  "POST /admin/logout",
]);

async function buildAdminApp(): Promise<{ app: FastifyInstance; routes: { method: string; url: string }[] }> {
  const app = Fastify({ logger: false, trustProxy: true });
  const routes: { method: string; url: string }[] = [];
  app.addHook("onRoute" as any, (routeOptions: any) => {
    if (typeof routeOptions.url === "string" && routeOptions.url.startsWith("/admin")) {
      const methods = Array.isArray(routeOptions.method) ? routeOptions.method : [routeOptions.method];
      for (const method of methods) {
        routes.push({ method, url: routeOptions.url });
      }
    }
  });

  await registerSession(app);
  await configureSecurity(app);

  const modules = await Promise.all([
    import("../routes/admin/index.js"),
    import("../routes/admin/oauth.js"),
    import("../routes/admin/posts.js"),
    import("../routes/admin/postsAi.js"),
    import("../routes/admin/postsUi.js"),
    import("../routes/admin/pages.js"),
    import("../routes/admin/pagesUi.js"),
    import("../routes/admin/postCategories.js"),
    import("../routes/admin/postCategoriesUi.js"),
    import("../routes/admin/productCategories.js"),
    import("../routes/admin/productCategoriesUi.js"),
    import("../routes/admin/topics.js"),
    import("../routes/admin/topicsUi.js"),
    import("../routes/admin/media.js"),
    import("../routes/admin/mediaUi.js"),
    import("../routes/admin/orders.js"),
    import("../routes/admin/ordersUi.js"),
    import("../routes/admin/products.js"),
    import("../routes/admin/productsUi.js"),
    import("../routes/admin/redirects.js"),
    import("../routes/admin/redirectsUi.js"),
    import("../routes/admin/automations.js"),
    import("../routes/admin/automationsUi.js"),
    import("../routes/admin/reviews.js"),
    import("../routes/admin/reviewsUi.js"),
    import("../routes/admin/settings.js"),
    import("../routes/admin/settingsUi.js"),
    import("../routes/admin/paymentMethods.js"),
    import("../routes/admin/shippingRules.js"),
    import("../routes/admin/stores.js"),
    import("../routes/admin/fulfillmentMethods.js"),
    import("../routes/admin/coupons.js"),
    import("../routes/admin/users.js"),
    import("../routes/admin/usersUi.js"),
    import("../routes/admin/agents.js"),
    import("../routes/admin/agentsUi.js"),
    import("../routes/admin/plugins.js"),
    import("../routes/admin/menus.js"),
    import("../routes/admin/menusUi.js"),
    import("../routes/admin/themes.js"),
    import("../routes/admin/themesUi.js"),
    import("../routes/admin/themeCustomize.js"),
    import("../routes/admin/themeChat.js"),
    import("../routes/admin/aiChat.js"),
    import("../routes/admin/mcpChat.js"),
    import("../routes/admin/customerChat.js"),
    import("../routes/admin/themeEditorUi.js"),
    import("../routes/admin/themePreview.js"),
    import("../routes/admin/seo.js"),
    import("../routes/admin/themeInlineEdit.js"),
    import("../routes/admin/search.js"),
    import("../routes/admin/preview.js"),
  ]);

  const registerFns = modules.map((m) => Object.values(m).find((v) => typeof v === "function")).filter(Boolean) as ((app: FastifyInstance) => Promise<void>)[];

  for (const register of registerFns) {
    await register(app);
  }

  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });

  await app.ready();
  return { app, routes };
}

function fillParams(url: string): string {
  return url.replace(/:[^/]+/g, "test-id-does-not-exist");
}

describe("admin route auth guard", () => {
  let app: FastifyInstance;
  let routes: { method: string; url: string }[];

  beforeAll(async () => {
    const built = await buildAdminApp();
    app = built.app;
    routes = built.routes;
  });

  afterAll(async () => {
    await app.close();
  });

  it("discovered a substantial number of /admin routes (sanity check the app actually wired up)", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("rejects every non-public /admin route when called with no session", async () => {
    const failures: string[] = [];

    for (const { method, url } of routes) {
      // HEAD la bien the Fastify tu sinh cho moi GET (exposeHeadRoutes mac dinh) - khong phai be
      // mat bao mat rieng, chi mirror lai GET tru body. Bo qua, GET tuong ung da du dai dien.
      if (method === "HEAD") continue;
      const key = `${method} ${url}`;
      if (PUBLIC_ADMIN_ROUTES.has(key)) continue;

      const res = await app.inject({ method: method as any, url: fillParams(url) });
      const isApi = url.startsWith("/admin/api") || url.includes("/api/");
      const rejectedAsApi = isApi && res.statusCode === 401;
      const rejectedAsUnauthorized = res.statusCode === 401 || res.statusCode === 403;
      const rejectedAsRedirect = !isApi && res.statusCode >= 300 && res.statusCode < 400;

      if (!(rejectedAsApi || rejectedAsUnauthorized || rejectedAsRedirect)) {
        failures.push(`${key} -> got ${res.statusCode} (expected 401/403 or a login redirect)`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} admin route(s) do NOT require authentication:\n${failures.join("\n")}`);
    }
  });
});
