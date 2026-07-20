import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { verifySiteEngineRequest } from "../../security.js";

// LeadBase chủ động đẩy mỗi khi sản phẩm đổi (system_design.md §4.2) — 1 trong 3 API HTTP thật
// duy nhất của toàn hệ thống, ký HMAC bằng Website.secret (= config.siteEngineSecret của CHÍNH
// instance này). "create" tạo ProductCache MỚI (status mặc định 'draft', name/description/
// imageUrls chỉ là giá trị khởi tạo — sync sau không ghi đè). "update" CHỈ đụng price/salePrice/
// stock/leadbaseStatus/syncedAt, không đụng nội dung do website tự quản.
//
// "variants" (optional, cả 2 action) — sản phẩm có biến thể (LeadBase Product.has_variants).
// Khi có mặt: set hasVariants=true + upsert từng ProductVariantCache theo leadbaseVariantId (idempotent
// y hệt cách product tự xử lý retry trùng ở trên). price/salePrice/stock/status TOP-LEVEL vẫn nhận
// bình thường (LeadBase tự gửi giá thấp nhất/tổng tồn) để nơi nào chưa biết variant vẫn có số dùng.
const variantSchema = z.object({
  leadbaseVariantId: z.string().min(1),
  sku: z.string().nullable().optional(),
  attributes: z.record(z.string()).optional(),
  price: z.number(),
  salePrice: z.number().nullable().optional(),
  stock: z.number().nullable().optional(),
  status: z.string().min(1),
});

// Danh mục — LeadBase sở hữu name/slug (mirror phẳng, bỏ qua parent_id), site-engine chỉ upsert
// theo leadbaseCategoryId rồi gán categoryId lên ProductCache. Dùng CHUNG bảng Category với danh
// mục bài viết (type='product' ở đây) — nếu LeadBase gửi 1 category CHƯA từng có trong Category
// thì upsert TỰ TẠO MỚI ngay (create branch dưới), khớp đúng leadbaseCategoryId lần sau. excerpt/
// body/seo (nội dung trang danh mục, sửa ở routes/admin/productCategories.ts) KHÔNG nằm trong
// "update" nên không bao giờ bị đồng bộ đè mất.
const categorySchema = z.object({
  leadbaseCategoryId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
});

const syncSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    leadbaseProductId: z.string().min(1),
    name: z.string().min(1),
    price: z.number(),
    salePrice: z.number().nullable().optional(),
    stock: z.number().nullable().optional(),
    status: z.string().min(1),
    variants: z.array(variantSchema).optional(),
    category: categorySchema.optional(),
  }),
  z.object({
    action: z.literal("update"),
    leadbaseProductId: z.string().min(1),
    price: z.number(),
    salePrice: z.number().nullable().optional(),
    stock: z.number().nullable().optional(),
    status: z.string().min(1),
    variants: z.array(variantSchema).optional(),
    category: categorySchema.optional(),
  }),
]);

async function resolveCategoryId(category: z.infer<typeof categorySchema> | undefined): Promise<string | null> {
  if (!category) {
    return null;
  }
  const upserted = await prisma.category.upsert({
    where: { leadbaseCategoryId: category.leadbaseCategoryId },
    create: {
      type: "product",
      leadbaseCategoryId: category.leadbaseCategoryId,
      name: category.name,
      slug: category.slug,
      syncedAt: new Date(),
    },
    update: { name: category.name, slug: category.slug, syncedAt: new Date() },
  });
  return upserted.id;
}

async function upsertVariants(productCacheId: string, variants: z.infer<typeof variantSchema>[]): Promise<void> {
  for (const v of variants) {
    await prisma.productVariantCache.upsert({
      where: { leadbaseVariantId: v.leadbaseVariantId },
      create: {
        leadbaseVariantId: v.leadbaseVariantId,
        productCacheId,
        sku: v.sku ?? null,
        attributes: v.attributes ?? {},
        price: v.price,
        salePrice: v.salePrice ?? null,
        stock: v.stock ?? null,
        leadbaseStatus: v.status,
      },
      update: {
        sku: v.sku ?? null,
        attributes: v.attributes ?? {},
        price: v.price,
        salePrice: v.salePrice ?? null,
        stock: v.stock ?? null,
        leadbaseStatus: v.status,
        syncedAt: new Date(),
      },
    });
  }
}

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
    const hasVariants = !!parsed.data.variants && parsed.data.variants.length > 0;
    const categoryId = await resolveCategoryId(parsed.data.category);

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
            hasVariants,
            categories: { set: categoryId ? [{ id: categoryId }] : [] },
            syncedAt: new Date(),
          },
        });
        if (hasVariants) {
          await upsertVariants(existing.id, parsed.data.variants!);
        }
        return { success: true };
      }

      const created = await prisma.productCache.create({
        data: {
          leadbaseProductId,
          name: parsed.data.name,
          price: parsed.data.price,
          salePrice: parsed.data.salePrice ?? null,
          stock: parsed.data.stock ?? null,
          leadbaseStatus: parsed.data.status,
          imageUrls: [],
          status: "draft",
          hasVariants,
          ...(categoryId ? { categories: { connect: [{ id: categoryId }] } } : {}),
        },
      });
      if (hasVariants) {
        await upsertVariants(created.id, parsed.data.variants!);
      }
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
        hasVariants,
        categories: { set: categoryId ? [{ id: categoryId }] : [] },
        syncedAt: new Date(),
      },
    });
    if (hasVariants) {
      await upsertVariants(existing.id, parsed.data.variants!);
    }

    return { success: true };
  });
}
