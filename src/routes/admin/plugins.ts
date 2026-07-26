import { FastifyInstance } from "fastify";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

// He thong plugin dong (tai code tu src/addons/, chay khong sandbox trong cung process voi
// server) da bi go bo hoan toan vi rui ro bao mat (plugin co the doc/ghi/xoa bat ky file nao,
// exfiltrate secret qua .env/process.env, khong co gi ngan duoc - xem lich su commit). Tinh nang
// "customer-support" (live-chat AI CSKH) da chuyen thanh core feature (routes/public/customerChat.ts,
// routes/admin/customerChat.ts). Trang nay CHI con lai lam placeholder cho toi khi thiet ke lai.
export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/plugins", { preHandler: requireRole("admin") }, async (request, reply) => {
    const html = await renderAdmin("plugins-list", {
      pageTitle: "Plugins",
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });
}
