import { FastifyInstance } from "fastify";

// Dashboard stub (system_design.md §8) - chi de verify luong dang nhap end-to-end (Phase 3).
// Middleware bao ve /admin/* day du (check permissions) la task rieng, chua lam o day.
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) {
      return reply.code(401).send({ error: "Chưa đăng nhập" });
    }

    return {
      userId,
      email: request.session.get("email"),
      permissions: request.session.get("permissions"),
    };
  });
}
