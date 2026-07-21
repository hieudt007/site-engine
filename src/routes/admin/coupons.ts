import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

const PAGE_SIZE = 20;

const couponSchema = z.object({
  code: z.string().min(1).transform((v) => v.trim().toUpperCase()),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.number().int().positive(),
  minOrderTotal: z.number().int().nonnegative().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  enabled: z.boolean().optional(),
});

export async function registerCouponRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string } }>(
    "/admin/api/coupons",
    { preHandler: requireRole("manager") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const [coupons, total] = await Promise.all([
        prisma.coupon.findMany({ orderBy: { createdAt: "desc" }, skip, take: PAGE_SIZE }),
        prisma.coupon.count(),
      ]);
      return { coupons, total, page, hasNext: skip + coupons.length < total, hasPrev: page > 1 };
    },
  );

  app.post("/admin/api/coupons", { preHandler: requireRole("manager") }, async (request, reply) => {
    const parsed = couponSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const existing = await prisma.coupon.findUnique({ where: { code: parsed.data.code } });
    if (existing) {
      return reply.code(422).send({ error: "Mã giảm giá đã tồn tại" });
    }
    const coupon = await prisma.coupon.create({
      data: {
        code: parsed.data.code,
        discountType: parsed.data.discountType,
        discountValue: parsed.data.discountValue,
        minOrderTotal: parsed.data.minOrderTotal ?? 0,
        maxUses: parsed.data.maxUses ?? null,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
        enabled: parsed.data.enabled ?? true,
      },
    });
    return reply.code(201).send({ coupon });
  });

  app.patch<{ Params: { id: string } }>(
    "/admin/api/coupons/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = couponSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const { expiresAt, ...rest } = parsed.data;
      const coupon = await prisma.coupon.update({
        where: { id: request.params.id },
        data: {
          ...rest,
          ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}),
        },
      });
      return { coupon };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/api/coupons/:id",
    { preHandler: requireRole("manager") },
    async (request) => {
      await prisma.coupon.delete({ where: { id: request.params.id } });
      return { success: true };
    },
  );
}
