import cookie from "@fastify/cookie";
import fastifySession from "@fastify/session";
import { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { PrismaSessionStore } from "../services/sessionStore.js";

declare module "fastify" {
  interface Session {
    userId?: number;
    email?: string;
    name?: string;
    role?: string; // 'admin' | 'manager' | 'edit'
  }
}

// Session admin vào /admin (đăng nhập qua OAuth thật của LeadBase, prisma/schema.prisma model
// User) — cookie riêng, KHÁC cookie khách hàng (plugins/customerSession.ts, chưa code — Phase 4).
export async function registerSession(app: FastifyInstance): Promise<void> {
  await app.register(cookie);
  await app.register(fastifySession, {
    secret: config.sessionSecret,
    cookieName: "site_engine_session",
    store: new PrismaSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 ngày (system_design.md §5.1)
    },
  });
}
