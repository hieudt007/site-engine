import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { renderAdmin } from "../../services/adminView.js";

const sendSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});

// Trang quan tri Live Chat (truoc day la trang cua plugin "customer-support") + API cho no.
export async function registerCustomerChatAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/live-chat", { preHandler: requireRole("admin") }, async (request, reply) => {
    const html = await renderAdmin("live-chat", {
      pageTitle: "Live Chat",
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get("/admin/api/customer-chat/sessions", { preHandler: requireRole("admin") }, async () => {
    const recentMessages = await prisma.customerChatMessage.findMany({
      orderBy: { id: "desc" },
      take: 200,
    });

    const sessionsMap = new Map<string, { sessionId: string; lastMessage: string; lastRole: string; updatedAt: Date }>();
    for (const msg of recentMessages) {
      if (!msg.sessionId || sessionsMap.has(msg.sessionId)) continue;
      sessionsMap.set(msg.sessionId, {
        sessionId: msg.sessionId,
        lastMessage: msg.message,
        lastRole: msg.role,
        updatedAt: msg.createdAt,
      });
    }

    return { sessions: Array.from(sessionsMap.values()) };
  });

  app.get<{ Querystring: { sessionId: string } }>(
    "/admin/api/customer-chat/history",
    { preHandler: requireRole("admin") },
    async (request) => {
      const { sessionId } = request.query;
      const records = await prisma.customerChatMessage.findMany({
        where: { sessionId },
        orderBy: { id: "asc" },
        take: 100,
      });
      const history = records.map((r) => ({ id: r.id, role: r.role, content: r.message, createdAt: r.createdAt }));
      return { history };
    },
  );

  app.post("/admin/api/customer-chat/send", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = sendSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ error: parsed.error.flatten() });

    const { sessionId, message } = parsed.data;
    const record = await prisma.customerChatMessage.create({
      data: { sessionId, agentKey: "customer", role: "admin", message },
    });

    return { success: true, record };
  });
}
