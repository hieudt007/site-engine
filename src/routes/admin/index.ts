import { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/requireRole.js";

// Dashboard stub (system_design.md §8) - chi de verify luong dang nhap end-to-end (Phase 3).
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", { preHandler: requireRole("edit") }, async (request) => {
    return {
      userId: request.session.get("userId"),
      email: request.session.get("email"),
      role: request.session.get("role"),
    };
  });
}
