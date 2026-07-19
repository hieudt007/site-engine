import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { verifySiteEngineRequest } from "../../security.js";

// LeadBase chủ động đẩy mỗi khi sản phẩm đổi (system_design.md §4.2) — 1 trong 3 API HTTP thật
// duy nhất của toàn hệ thống, ký HMAC bằng Website.secret (= config.siteEngineSecret của CHÍNH
// instance này). "create" tạo ProductCache MỚI (publishStatus mặc định 'draft', name/description/
// imageUrls chỉ là giá trị khởi tạo — sync sau không ghi đè). "update" CHỈ đụng price/salePrice/
// stock/leadbaseStatus/syncedAt, không đụng nội dung do website tự quản.
const syncSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    leadbaseProductId: z.string().min(1),
    name: z.string().min(1),
    price: z.number(),
    salePrice: z.number().nullable().optional(),
    stock: z.number().nullable().optional(),
    status: z.string().min(1),
  }),
  z.object({
    action: z.literal("update"),
    leadbaseProductId: z.string().min(1),
    price: z.number(),
    salePrice: z.number().nullable().optional(),
    stock: z.number().nullable().optional(),
    status: z.string().min(1),
  }),
]);

export async function registerProductsSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/products/sync", async (request, reply) => {
    const signature = request.headers["x-site-engine-signature-256"];
    const timestamp = request.headers["x-site-engine-timestamp"];
    if (typeof signature !== "string" || typeof timestamp !== "string" || !request.rawBody) {
      return reply.code(401).send({ error: "Thiếu chữ ký" });
    }
    if (!verifySiteEngineRequest(config.siteEngineSecret, timestamp, request.rawBody, signature)) {
      return reply.code(401).send({ error: "Chữ ký không hợp lệ" });
    }

    const parsed = syncSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const { leadbaseProductId } = parsed.data;

    if (parsed.data.action === "create") {
      const existing = await prisma.productCache.findUnique({ where: { leadbaseProductId } });
      if (existing) {
        // Đã tồn tại (vd retry trùng của LeadBase) - coi như update để không tạo bản ghi trùng.
        await prisma.productCache.update({
          where: { leadbaseProductId },
          data: {
            price: parsed.data.price,
            salePrice: parsed.data.salePrice ?? null,
            stock: parsed.data.stock ?? null,
            leadbaseStatus: parsed.data.status,
            syncedAt: new Date(),
          },
        });
        return { success: true };
      }

      await prisma.productCache.create({
        data: {
          leadbaseProductId,
          name: parsed.data.name,
          price: parsed.data.price,
          salePrice: parsed.data.salePrice ?? null,
          stock: parsed.data.stock ?? null,
          leadbaseStatus: parsed.data.status,
          imageUrls: [],
          publishStatus: "draft",
        },
      });
      return { success: true };
    }

    // action === "update"
    const existing = await prisma.productCache.findUnique({ where: { leadbaseProductId } });
    if (!existing) {
      return reply.code(404).send({ error: "Sản phẩm chưa được sync 'create' trước đó" });
    }

    await prisma.productCache.update({
      where: { leadbaseProductId },
      data: {
        price: parsed.data.price,
        salePrice: parsed.data.salePrice ?? null,
        stock: parsed.data.stock ?? null,
        leadbaseStatus: parsed.data.status,
        syncedAt: new Date(),
      },
    });

    return { success: true };
  });
}
