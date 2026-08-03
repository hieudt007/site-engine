import { FastifyInstance } from "fastify";
import { requireRole } from "../../plugins/requireRole.js";
import { renderAdmin } from "../../services/adminView.js";
import { importWordpressXml } from "../../services/wordpressImport.js";

// Import bai viet tu file export WordPress (WXR/.xml, Tools > Export > All content hoac Posts).
// "manager" tro len moi duoc dung (tao hang loat noi dung, tuong duong quyen tao/sua bai hang loat).
export async function registerImportWordpressRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/import", { preHandler: requireRole("manager") }, async (request, reply) => {
    const html = await renderAdmin("import-wordpress", {
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.post("/admin/api/import/wordpress", { preHandler: requireRole("manager") }, async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB - WXR co the chua nhieu bai/postmeta
    if (!file) {
      return reply.code(422).send({ error: "Thiếu file .xml" });
    }

    const buffer = await file.toBuffer();
    const xml = buffer.toString("utf-8");
    const userId = request.session.get("userId") ?? null;

    try {
      const summary = await importWordpressXml(xml, userId);
      return reply.send({ summary });
    } catch (err) {
      request.log.error(err);
      return reply.code(422).send({ error: "Không đọc được file - kiểm tra đây có đúng là file export WordPress (.xml) không." });
    }
  });
}
