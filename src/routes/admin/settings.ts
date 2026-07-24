import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";

// Cài đặt chung của CHÍNH website đang chạy (system_design.md §10.1) - đúng 1 row "singleton".
// §5.2: settings là quyền admin duy nhất, manager/edit không đụng được.
const updateSettingsSchema = z
  .object({
    siteName: z.string().min(1).optional(),
    tagline: z.string().optional(),
    logoUrl: z.string().optional(),
    faviconUrl: z.string().optional(),
    contactEmail: z.string().optional(),
    contactPhone: z.string().optional(),
    contactAddress: z.string().optional(),
    socialLinks: z
      .object({
        facebook: z.string().optional(),
        zalo: z.string().optional(),
        tiktok: z.string().optional(),
        youtube: z.string().optional(),
      })
      .optional(),
    businessLicense: z.string().optional(),
    defaultOgImage: z.string().optional(),
    siteType: z.enum(["blog", "ecommerce"]).optional(),
    postSlugPrefix: z.string().regex(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/, "prefix chỉ gồm chữ thường/số, cách nhau bằng -").optional(),
    pageSlugPrefix: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "prefix trang chỉ gồm chữ thường/số, cách nhau bằng - và không được để trống").optional(),
    productSlugPrefix: z.string().regex(/^$|^[a-z0-9]+(-[a-z0-9]+)*$/, "prefix chỉ gồm chữ thường/số, cách nhau bằng -").optional(),
    gaId: z.string().optional(),
    fbPixelId: z.string().optional(),
    customHeadScript: z.string().optional(),
    gscVerificationId: z.string().optional(),
    turnstileSiteKey: z.string().optional(),
    turnstileSecretKey: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const postPrefix = data.postSlugPrefix?.trim();
    const pagePrefix = data.pageSlugPrefix?.trim();
    const productPrefix = data.productSlugPrefix?.trim();
    if (postPrefix !== undefined && productPrefix !== undefined && postPrefix === "" && productPrefix === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productSlugPrefix"],
        message: "Chỉ một trong hai prefix bài viết/sản phẩm được để trống",
      });
    }
    if (postPrefix && productPrefix && postPrefix === productPrefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["productSlugPrefix"],
        message: "Prefix bài viết và sản phẩm không được trùng nhau",
      });
    }
    if (pagePrefix && postPrefix && pagePrefix === postPrefix) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pageSlugPrefix"], message: "Prefix trang không được trùng prefix bài viết" });
    }
    if (pagePrefix && productPrefix && pagePrefix === productPrefix) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pageSlugPrefix"], message: "Prefix trang không được trùng prefix sản phẩm" });
    }
  });

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/settings", { preHandler: requireRole("admin") }, async (request) => {
    const settings = await getOrCreateSiteConfig(request.hostname);
    return { settings };
  });

  app.patch("/admin/api/settings", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const current = await getOrCreateSiteConfig(request.hostname);
    const currentPrefixes = current as unknown as { postSlugPrefix?: string | null; pageSlugPrefix?: string | null; productSlugPrefix?: string | null };
    const nextPostPrefix = parsed.data.postSlugPrefix !== undefined ? parsed.data.postSlugPrefix.trim() : (currentPrefixes.postSlugPrefix ?? "blog");
    const nextPagePrefix = parsed.data.pageSlugPrefix !== undefined ? parsed.data.pageSlugPrefix.trim() : (currentPrefixes.pageSlugPrefix ?? "p");
    const nextProductPrefix = parsed.data.productSlugPrefix !== undefined ? parsed.data.productSlugPrefix.trim() : (currentPrefixes.productSlugPrefix ?? "product");
    if (nextPostPrefix === "" && nextProductPrefix === "") {
      return reply.code(422).send({ error: "Chỉ một trong hai prefix bài viết/sản phẩm được để trống" });
    }
    if (!nextPagePrefix) {
      return reply.code(422).send({ error: "Prefix trang tĩnh không được để trống" });
    }
    if (nextPostPrefix && nextProductPrefix && nextPostPrefix === nextProductPrefix) {
      return reply.code(422).send({ error: "Prefix bài viết và sản phẩm không được trùng nhau" });
    }
    if (nextPagePrefix && nextPagePrefix === nextPostPrefix) {
      return reply.code(422).send({ error: "Prefix trang không được trùng prefix bài viết" });
    }
    if (nextPagePrefix && nextPagePrefix === nextProductPrefix) {
      return reply.code(422).send({ error: "Prefix trang không được trùng prefix sản phẩm" });
    }

    let updated;
    try {
      updated = await prisma.siteConfig.update({
        where: { id: "singleton" },
        data: {
          ...parsed.data,
          ...(parsed.data.postSlugPrefix !== undefined ? { postSlugPrefix: parsed.data.postSlugPrefix.trim() } : {}),
          ...(parsed.data.pageSlugPrefix !== undefined ? { pageSlugPrefix: parsed.data.pageSlugPrefix.trim() } : {}),
          ...(parsed.data.productSlugPrefix !== undefined ? { productSlugPrefix: parsed.data.productSlugPrefix.trim() } : {}),
          gscVerificationId: parsed.data.gscVerificationId,
        },
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: "Không lưu được cài đặt. Vui lòng chạy cập nhật database/Prisma client rồi khởi động lại server.",
      });
    }

    return { settings: updated };
  });
}
