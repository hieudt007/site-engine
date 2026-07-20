import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// Danh sách tài khoản quản trị (User) đã từng đăng nhập qua OAuth LeadBase — CHỈ ĐỌC, không có
// tạo/sửa/xoá tay ở đây: mọi thứ (leadbaseUserId/name/email/role) đồng bộ lại tự động mỗi lần
// đăng nhập (routes/admin/oauth.ts upsert), y hệt cách User được tạo lần đầu. "admin" trở lên
// mới xem được (cùng nhóm quyền với Cài đặt).
export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/users", { preHandler: requireRole("admin") }, async () => {
    const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
    return { users };
  });
}
