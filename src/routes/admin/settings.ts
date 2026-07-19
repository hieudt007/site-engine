import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

// Cài đặt chung của CHÍNH website đang chạy (system_design.md §10.1) - đúng 1 row "singleton".
// §5.2: settings là quyền admin duy nhất, manager/edit không đụng được.
const updateSettingsSchema = z.object({
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
});

async function getOrCreateSettings(domain: string) {
  const existing = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  if (existing) {
    return existing;
  }
  return prisma.siteConfig.create({
    data: { id: "singleton", domain, siteName: domain },
  });
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/settings", { preHandler: requireRole("admin") }, async (request) => {
    const settings = await getOrCreateSettings(request.hostname);
    return { settings };
  });

  app.patch("/admin/api/settings", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    await getOrCreateSettings(request.hostname);
    const updated = await prisma.siteConfig.update({
      where: { id: "singleton" },
      data: parsed.data,
    });

    return { settings: updated };
  });
}
