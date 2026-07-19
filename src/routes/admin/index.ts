import { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/requireRole.js";

// Chưa có dashboard tổng quan thật (system_design.md §8, TBD) - /admin/posts là màn hình quản
// trị duy nhất đã xong nên điều hướng thẳng vào đó thay vì để browser thấy JSON trần.
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", { preHandler: requireRole("edit") }, async (request, reply) => {
    return reply.redirect("/admin/posts");
  });
}
