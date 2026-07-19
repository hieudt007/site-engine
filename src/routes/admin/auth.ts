import bcrypt from "bcryptjs";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Đăng nhập ĐỘC LẬP bằng email/mật khẩu — KHÔNG qua LeadBase, KHÔNG SSO/HMAC (đảo ngược quyết
// định trước, xem prisma/schema.prisma model User). Tài khoản admin đầu tiên được seed lúc
// khởi động từ ADMIN_EMAIL/ADMIN_PASSWORD (services/seedAdmin.ts).
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Email/mật khẩu không hợp lệ" });
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) {
      return reply.code(401).send({ error: "Sai email hoặc mật khẩu" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "Sai email hoặc mật khẩu" });
    }

    request.session.set("userId", user.id);
    request.session.set("email", user.email);
    request.session.set("permissions", user.permissions);

    return { success: true };
  });

  app.post("/admin/logout", async (request, reply) => {
    await request.session.destroy();
    return { success: true };
  });
}
