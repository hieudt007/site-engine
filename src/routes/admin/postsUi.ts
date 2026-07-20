import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderAdmin } from "../../services/adminView.js";
import { requireRole } from "../../plugins/requireRole.js";

// Trang HTML danh sách/soạn bài trong /admin — gọi JSON API ở /admin/api/posts/* bằng fetch()
// phía client (xem views/admin/*.liquid). Editor là <textarea> thường (rich text lib TBD,
// system_design.md task_list §Phase 3) — body lưu markdown/HTML đã sanitize theo docblock Post.
export async function registerPostsUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/posts", { preHandler: requireRole("edit") }, async (request, reply) => {
    const categories = await prisma.postCategory.findMany({ orderBy: { name: "asc" } });
    const html = await renderAdmin("posts-list", {
      categories,
      userName: request.session.get("name"), role: request.session.get("role"),
      currentPath: request.url,
    });
    return reply.type("text/html").send(html);
  });

  app.get("/admin/posts/new", { preHandler: requireRole("edit") }, async (request, reply) => {
    const categories = await prisma.postCategory.findMany({ orderBy: { name: "asc" } });
    const html = await renderAdmin("post-edit", { post: null, categories, userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
    return reply.type("text/html").send(html);
  });

  app.get<{ Params: { id: string } }>(
    "/admin/posts/:id",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const [post, categories] = await Promise.all([
        prisma.post.findUnique({ where: { id: request.params.id } }),
        prisma.postCategory.findMany({ orderBy: { name: "asc" } }),
      ]);
      if (!post || post.type !== "post") {
        return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy bài viết</h1>");
      }
      const html = await renderAdmin("post-edit", { post, categories, userName: request.session.get("name"), role: request.session.get("role"), currentPath: request.url });
      return reply.type("text/html").send(html);
    },
  );
}
