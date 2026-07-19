import { prisma } from "../db.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày, khớp plugins/session.ts cookie.maxAge

type Callback<T = void> = (err: Error | null, result?: T) => void;

// Store cho @fastify/session — Session Prisma-backed (system_design.md §1/§5.1), KHÔNG dùng
// memory store vì mất session khi restart process (systemd Restart=on-failure).
export class PrismaSessionStore {
  get(sessionId: string, callback: Callback<any>): void {
    prisma.session
      .findUnique({ where: { id: sessionId } })
      .then((row) => {
        if (!row || row.expiresAt < new Date()) {
          callback(null, undefined);
          return;
        }
        callback(null, JSON.parse(row.data));
      })
      .catch((err) => callback(err));
  }

  set(sessionId: string, session: any, callback: Callback): void {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    prisma.session
      .upsert({
        where: { id: sessionId },
        create: { id: sessionId, data: JSON.stringify(session), expiresAt },
        update: { data: JSON.stringify(session), expiresAt },
      })
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sessionId: string, callback: Callback): void {
    prisma.session
      .delete({ where: { id: sessionId } })
      .then(() => callback(null))
      .catch(() => callback(null)); // xoá session không tồn tại không phải lỗi
  }
}
