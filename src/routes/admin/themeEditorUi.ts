import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_FILE_CONTRACTS, THEME_ASSET_FILES } from "../../services/themeContract.js";

// Trang editor toan man hinh cho 1 CustomTheme (agent-generated) - 3 cot: cay file / xem noi dung /
// chat AI. Thay the panel nhung truoc day trong settings-theme.liquid (xem lich su thiet ke: ban
// dau nhet vao 1 card trong cung trang, sau chuyen sang trang rieng theo yeu cau).
export async function registerThemeEditorUiRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>("/admin/themes/:slug/edit", { preHandler: requireRole("admin") }, async (request, reply) => {
    const customTheme = await prisma.customTheme.findUnique({ where: { slug: request.params.slug } });
    if (!customTheme) {
      return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy theme</h1>");
    }

    const files = [
      ...THEME_FILE_CONTRACTS.map((c) => ({ file: c.file, description: c.description })),
      ...THEME_ASSET_FILES.map((a) => ({ file: a.file, description: a.contentType.toUpperCase() + " tùy chỉnh" })),
    ];

    const html = await renderAdmin("theme-editor", {
      pageTitle: "Sửa theme — " + customTheme.name,
      userName: request.session.get("name"),
      role: request.session.get("role"),
      currentPath: request.url,
      theme: customTheme,
      files,
    });
    return reply.type("text/html").send(html);
  });
}
