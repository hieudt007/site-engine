import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { prisma } from "../db.js";

const BCRYPT_ROUNDS = 12;

// Tạo tài khoản admin ĐẦU TIÊN từ ADMIN_EMAIL/ADMIN_PASSWORD (do LeadBase truyền qua .env lúc
// tạo Website — WebsiteProvisionService.php). Chỉ chạy khi bảng User rỗng, KHÔNG ghi đè tài
// khoản đã có nếu chạy lại (vd sau khi tenant đã đổi mật khẩu).
export async function seedAdmin(): Promise<void> {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return;
  }

  if (!config.adminEmail || !config.adminPassword) {
    return;
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email: config.adminEmail.toLowerCase(),
      passwordHash,
      permissions: ["admin"],
    },
  });
}
