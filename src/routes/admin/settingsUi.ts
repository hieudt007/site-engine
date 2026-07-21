import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

export async function registerSettingsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/admin/settings/general",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const html = await renderAdmin("settings-general", { userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );

  app.get(
    "/admin/settings/payment",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const html = await renderAdmin("settings-payment", { userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );

  app.get(
    "/admin/settings/shipping",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const html = await renderAdmin("settings-shipping", { userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );

  app.get(
    "/admin/stores",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const html = await renderAdmin("stores-list", { userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );

  app.get(
    "/admin/coupons",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const html = await renderAdmin("coupons-list", { userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );
}
