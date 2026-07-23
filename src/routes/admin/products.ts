import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { saveRevision, listRevisions } from "../../services/revisions.js";
import { customFieldsSchema } from "../../services/customFields.js";
import { slugify } from "../../services/slug.js";
import { uniqueProductSlug } from "../../services/productSlug.js";
import { analyzeProductSeo } from "../../services/seoAnalyzer.js";

// §5.2: sản phẩm thuộc nhóm "nội dung + sản phẩm" của manager — role "edit" KHÔNG được đụng vào
// (khác Post, nơi edit tạo/sửa được bài nháp) — nên không có bước "nộp duyệt" như posts.ts,
// manager đi thẳng draft -> scheduled/published. price/salePrice/stock/leadbaseStatus là
// read-only từ phía website — chỉ LeadBase mới sửa được (qua routes/public/productsSync.ts, §4.2).
const seoSchema = z
  .object({
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().optional(),
    keyword: z.string().optional(),
    score: z.number().optional(),
    internalLinks: z.number().optional(),
    checks: z
      .array(
        z.object({
          key: z.string(),
          status: z.enum(["pass", "warning", "fail"]),
          message: z.string(),
          points: z.number(),
          maxPoints: z.number(),
        }),
      )
      .optional(),
    analyzedAt: z.string().optional(),
  })
  .optional();

const faqSchema = z
  .array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    }),
  )
  .optional();

const specSchema = z.object({ label: z.string().min(1), value: z.string().min(1) });

const relatedProductConfigSchema = z.object({
  mode: z.enum(["specific", "category"]),
  productIds: z.array(z.string()),
  categoryId: z.string().nullable(),
  limit: z.number().int().min(1).max(20).default(4),
});

const relatedProductsSchema = z.object({
  upsell: relatedProductConfigSchema.optional(),
  crossSell: relatedProductConfigSchema.optional(),
});

const createProductSchema = z.object({
  name: z.string().min(1),
  leadbaseProductId: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -").optional(),
  price: z.number().nonnegative().optional().default(0),
  salePrice: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().nullable().optional(),
  sku: z.string().nullable().optional(),
  excerpt: z.string().optional(),
  description: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  layoutMode: z.enum(["standard", "custom", "landing"]).optional(),
  seo: seoSchema,
  customFields: customFieldsSchema,
  faq: faqSchema,
  specs: z.array(specSchema).optional(),
  categoryIds: z.array(z.string()).optional(),
  brandId: z.string().nullable().optional(),
  relatedProducts: relatedProductsSchema.optional(),
}).refine(data => {
  if (data.salePrice != null && data.price != null) {
    return data.salePrice <= data.price;
  }
  return true;
}, {
  message: "Giá khuyến mãi không được lớn hơn giá bán",
  path: ["salePrice"]
});

const updateContentSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -").optional(),
  price: z.number().nonnegative().optional(),
  salePrice: z.number().nonnegative().nullable().optional(),
  stock: z.number().int().nonnegative().nullable().optional(),
  sku: z.string().nullable().optional(),
  excerpt: z.string().optional(),
  description: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  layoutMode: z.enum(["standard", "custom", "landing"]).optional(),
  seo: seoSchema,
  customFields: customFieldsSchema,
  faq: faqSchema,
  specs: z.array(specSchema).optional(),
  categoryIds: z.array(z.string()).optional(),
  brandId: z.string().nullable().optional(),
  relatedProducts: relatedProductsSchema.optional(),
}).refine(data => {
  if (data.salePrice != null && data.price != null) {
    return data.salePrice <= data.price;
  }
  return true;
}, {
  message: "Giá khuyến mãi không được lớn hơn giá bán",
  path: ["salePrice"]
});

const scheduleSchema = z.object({ scheduledAt: z.string().min(1) });
const PAGE_SIZE = 20;

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { page?: string; q?: string; categoryId?: string; status?: string } }>(
    "/admin/api/products",
    { preHandler: requireRole("manager") },
    async (request) => {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      const skip = (page - 1) * PAGE_SIZE;
      const { q, categoryId, status } = request.query;

      const where = {
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
        ...(categoryId ? { categories: { some: { id: categoryId } } } : {}),
        ...(status ? { status } : {}),
      };

      const [products, total] = await Promise.all([
        prisma.productCache.findMany({
          where,
          orderBy: { syncedAt: "desc" },
          skip,
          take: PAGE_SIZE,
          include: { categories: { select: { name: true } } },
        }),
        prisma.productCache.count({ where }),
      ]);

      return { products, total, page, totalPages: Math.ceil(total / PAGE_SIZE), hasNext: skip + products.length < total, hasPrev: page > 1 };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/products/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({
        where: { id: request.params.id },
        include: { variants: { orderBy: { syncedAt: "asc" } } },
      });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }
      
      let resolvedRelatedProducts: any = null;
      if (product.relatedProducts) {
        const rp = product.relatedProducts as any;
        resolvedRelatedProducts = { upsell: null, crossSell: null };
        
        for (const type of ["upsell", "crossSell"] as const) {
          if (rp[type]) {
             resolvedRelatedProducts[type] = { ...rp[type], resolvedProducts: [], resolvedCategory: null };
             if (rp[type].mode === "specific" && rp[type].productIds.length > 0) {
               resolvedRelatedProducts[type].resolvedProducts = await prisma.productCache.findMany({
                 where: { id: { in: rp[type].productIds } },
                 select: { id: true, name: true, imageUrls: true }
               });
             } else if (rp[type].mode === "category" && rp[type].categoryId) {
               resolvedRelatedProducts[type].resolvedCategory = await prisma.category.findUnique({
                 where: { id: rp[type].categoryId },
                 select: { id: true, name: true }
               });
             }
          }
        }
      }

      return { product, resolvedRelatedProducts };
    },
  );

  app.post(
    "/admin/api/products",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = createProductSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ issues: parsed.error.issues }, "Validation error in createProduct");
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const userId = request.session.get("userId") ?? null;
      let nextSlug = parsed.data.slug ?? slugify(parsed.data.name);
      const slugTaken = await prisma.productCache.findUnique({ where: { slug: nextSlug } as any });
      
      // If slug taken, append unique part
      if (slugTaken) {
        nextSlug = await uniqueProductSlug(nextSlug);
      }
      
      const leadbaseIdTaken = await prisma.productCache.findUnique({ where: { leadbaseProductId: parsed.data.leadbaseProductId } });
      if (leadbaseIdTaken) {
         return reply.code(409).send({ error: "ID Sản phẩm LeadBase này đã tồn tại" });
      }

      const { categoryIds, brandId, ...restParsed } = parsed.data;

      const dataWithSeo = {
        ...restParsed,
        brandId: brandId || null,
        slug: nextSlug,
        seo: analyzeProductSeo({
          name: parsed.data.name,
          slug: nextSlug,
          description: parsed.data.description ?? null,
          excerpt: parsed.data.excerpt ?? null,
          imageUrls: parsed.data.imageUrls ?? [],
          seo: parsed.data.seo ?? {},
          faq: parsed.data.faq ?? [],
          specs: parsed.data.specs ?? [],
        }),
      };

      const product = await prisma.productCache.create({
        data: {
          ...dataWithSeo,
          categories: categoryIds && categoryIds.length > 0 ? { connect: categoryIds.map(id => ({ id })) } : undefined,
          leadbaseStatus: 'active',
          status: 'draft',
        } as any,
      });

      await saveRevision(
        "Product",
        product.id,
        {
          name: "",
          slug: "",
          excerpt: null,
          description: null,
          imageUrls: [],
          seo: {},
          customFields: {},
          specs: [],
          layoutMode: "standard",
          relatedProducts: {},
        },
        dataWithSeo,
        userId,
      );

      return { product };
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/api/products/:id",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = updateContentSchema.safeParse(request.body);
      if (!parsed.success) {
        request.log.warn({ issues: parsed.error.issues }, "Validation error in updateProduct");
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const userId = request.session.get("userId") ?? null;
      const nextSlug = parsed.data.slug ?? ((product as any).slug as string | null | undefined) ?? slugify(parsed.data.name ?? product.name);
      const slugTaken = await prisma.productCache.findUnique({ where: { slug: nextSlug } as any });
      if (slugTaken && slugTaken.id !== product.id) {
        return reply.code(409).send({ error: "Slug đã tồn tại" });
      }
      const { categoryIds, brandId, ...restParsed } = parsed.data;

      const updateData = {
        ...restParsed,
        slug: nextSlug,
        seo: analyzeProductSeo({
          name: parsed.data.name ?? product.name,
          slug: nextSlug,
          description: parsed.data.description ?? product.description,
          excerpt: parsed.data.excerpt ?? product.excerpt,
          imageUrls: parsed.data.imageUrls ?? product.imageUrls,
          seo: (parsed.data.seo as any) ?? product.seo ?? {},
          faq: (parsed.data.faq as any) ?? product.faq ?? [],
          specs: (parsed.data.specs as any) ?? product.specs ?? [],
        }),
      };
      await saveRevision(
        "Product",
        product.id,
        {
          name: product.name,
          slug: (product as any).slug,
          excerpt: product.excerpt,
          description: product.description,
          imageUrls: product.imageUrls,
          seo: product.seo,
          customFields: product.customFields,
          specs: product.specs,
          layoutMode: product.layoutMode,
          relatedProducts: product.relatedProducts,
        },
        updateData,
        userId,
      );

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: {
          ...updateData,
          brandId: brandId !== undefined ? (brandId || null) : product.brandId,
          categories: categoryIds !== undefined ? { set: categoryIds.map(id => ({ id })) } : undefined,
        } as any,
      });

      return { product: updated };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/api/products/:id/revisions",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }
      const revisions = await listRevisions("Product", product.id);
      return { revisions };
    },
  );

  app.post<{ Params: { id: string; revisionId: string } }>(
    "/admin/api/products/:id/revisions/:revisionId/restore",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const revision = await prisma.revision.findUnique({ where: { id: request.params.revisionId } });
      if (!revision || revision.entityType !== "Product" || revision.entityId !== product.id) {
        return reply.code(404).send({ error: "Không tìm thấy bản ghi lịch sử" });
      }

      const userId = request.session.get("userId") ?? null;

      const snapshot = revision.data as {
        name: string;
        excerpt?: string | null;
        description: string | null;
        imageUrls: string[];
        seo: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        customFields: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        faq: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        specs?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
        layoutMode?: string;
        relatedProducts?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      };

      await saveRevision(
        "Product",
        product.id,
        {
          name: product.name,
          excerpt: product.excerpt,
          description: product.description,
          imageUrls: product.imageUrls,
          seo: product.seo,
          customFields: product.customFields,
          specs: product.specs,
          layoutMode: product.layoutMode,
          relatedProducts: product.relatedProducts,
        },
        snapshot,
        userId,
      );

      const updated = await prisma.productCache.update({ where: { id: product.id }, data: snapshot });

      return { product: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/products/:id/publish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: { status: "published", publishedAt: new Date(), scheduledAt: null },
      });
      return { product: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/products/:id/schedule",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = scheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const scheduledAt = new Date(parsed.data.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        return reply.code(422).send({ error: "Thời điểm lên lịch phải ở tương lai" });
      }

      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: { status: "scheduled", scheduledAt, publishedAt: null },
      });
      return { product: updated };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/api/products/:id/unpublish",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const product = await prisma.productCache.findUnique({ where: { id: request.params.id } });
      if (!product) {
        return reply.code(404).send({ error: "Không tìm thấy sản phẩm" });
      }

      const updated = await prisma.productCache.update({
        where: { id: product.id },
        data: { status: "draft", publishedAt: null, scheduledAt: null },
      });
      return { product: updated };
    },
  );
}
