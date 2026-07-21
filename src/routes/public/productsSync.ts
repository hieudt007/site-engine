import { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { verifySiteEngineRequest } from "../../security.js";

// LeadBase chủ động đẩy mỗi khi sản phẩm đổi (system_design.md §4.2) — 1 trong 3 API HTTP thật
// duy nhất của toàn hệ thống, ký HMAC bằng Website.secret (= config.siteEngineSecret của CHÍNH
// instance này). "create" tạo ProductCache MỚI (status mặc định 'draft', name/description/
// imageUrls chỉ là giá trị khởi tạo — sync sau không ghi đè). "update" CHỈ đụng price/salePrice/
// stock/leadbaseStatus/soldCount/syncedAt, không đụng nội dung do website tự quản (excerpt/
// description/imageUrls). soldCount optional (backward-compat nếu LeadBase chưa gửi) - undefined
// thì GIỮ NGUYÊN giá trị cũ, không reset về 0.
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

// Danh mục/Thương hiệu — LeadBase sở hữu name/slug (mirror phẳng, bỏ qua parent_id), site-engine
// chỉ upsert theo leadbaseCategoryId rồi gán categoryId/brandId lên ProductCache. Dùng CHUNG bảng
// Category (type='product' cho danh mục, type='brand' cho thương hiệu — 2 "khoang" tách biệt,
// leadbaseCategoryId chỉ unique THEO TỪNG type nên category id=5 và brand id=5 không đụng nhau) —
// nếu LeadBase gửi 1 category/brand CHƯA từng có thì upsert TỰ TẠO MỚI ngay, khớp đúng
// leadbaseCategoryId lần sau. excerpt/body/seo (nội dung trang danh mục, sửa ở
// routes/admin/productCategories.ts) KHÔNG nằm trong "update" nên không bao giờ bị đồng bộ đè mất.
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
    soldCount: z.number().int().nonnegative().optional(),
    sku: z.string().nullable().optional(),
    variants: z.array(variantSchema).optional(),
    category: categorySchema.optional(),
    brand: categorySchema.optional(),
  }),
  z.object({
    action: z.literal("update"),
    leadbaseProductId: z.string().min(1),
    price: z.number(),
    salePrice: z.number().nullable().optional(),
    stock: z.number().nullable().optional(),
    status: z.string().min(1),
    soldCount: z.number().int().nonnegative().optional(),
    sku: z.string().nullable().optional(),
    variants: z.array(variantSchema).optional(),
    category: categorySchema.optional(),
    brand: categorySchema.optional(),
  }),
]);

async function resolveTypedCategoryId(
  type: "product" | "brand",
  entry: z.infer<typeof categorySchema> | undefined,
): Promise<string | null> {
  if (!entry) {
    return null;
  }
  const upserted = await prisma.category.upsert({
    where: { type_leadbaseCategoryId: { type, leadbaseCategoryId: entry.leadbaseCategoryId } },
    create: {
      type,
      leadbaseCategoryId: entry.leadbaseCategoryId,
      name: entry.name,
      slug: entry.slug,
      syncedAt: new Date(),
    },
    update: { name: entry.name, slug: entry.slug, syncedAt: new Date() },
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
    const categoryId = await resolveTypedCategoryId("product", parsed.data.category);
    const brandId = await resolveTypedCategoryId("brand", parsed.data.brand);

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
            ...(parsed.data.soldCount !== undefined ? { soldCount: parsed.data.soldCount } : {}),
            ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku } : {}),
            hasVariants,
            categories: { set: categoryId ? [{ id: categoryId }] : [] },
            brandId,
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
          ...(parsed.data.soldCount !== undefined ? { soldCount: parsed.data.soldCount } : {}),
          ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku } : {}),
          imageUrls: [],
          status: "draft",
          hasVariants,
          ...(categoryId ? { categories: { connect: [{ id: categoryId }] } } : {}),
          brandId,
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
        ...(parsed.data.soldCount !== undefined ? { soldCount: parsed.data.soldCount } : {}),
        ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku } : {}),
        hasVariants,
        categories: { set: categoryId ? [{ id: categoryId }] : [] },
        brandId,
        syncedAt: new Date(),
      },
    });
    if (hasVariants) {
      await upsertVariants(existing.id, parsed.data.variants!);
    }

    return { success: true };
  });
}
