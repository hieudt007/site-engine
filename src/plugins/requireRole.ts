import { FastifyReply, FastifyRequest } from "fastify";

// Bảng role -> quyền (system_design.md §5.2). "edit" là sàn thấp nhất trong 3 role hợp lệ -
// bất kỳ role LeadBase nào khác admin/manager đều quy về "edit" ngay lúc userinfo trả về
// (OAuthUserInfoController::siteEngineRole bên lead-base), nên ở đây chỉ cần so đúng 3 giá trị.
export type Role = "admin" | "manager" | "edit";

export const ROLE_RANK: Record<Role, number> = { edit: 0, manager: 1, admin: 2 };

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "manager" || value === "edit";
}

// Chặn theo role TỐI THIỂU (vd requireRole("manager") thì "manager" và "admin" đều qua,
// "edit" bị chặn) - dùng cho hầu hết route theo đúng thứ bậc ở bảng §5.2. Route nào cần khớp
// CHÍNH XÁC 1 role (không theo thứ bậc) thì so sánh session.get("role") trực tiếp trong handler.
export function requireRole(minRole: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = request.session.get("userId");
    if (!userId) {
      if (request.url.startsWith("/admin") && !request.url.startsWith("/admin/api")) {
        return reply.redirect("/admin/login");
      }
      return reply.code(401).send({ error: "Chưa đăng nhập" });
    }

    const role = request.session.get("role");
    if (!isRole(role) || ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return reply.code(403).send({ error: "Không đủ quyền" });
    }
  };
}
