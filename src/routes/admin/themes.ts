import fs from "node:fs";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");

// Theme built-in = MỌI thư mục con thật sự tồn tại dưới themes/ (đóng gói sẵn cùng zip release,
// xem scripts/build-release.sh) — không cần khai báo danh sách tay, tự quét đĩa. Theme "custom"
// (agent-generated, cài qua /api/theme/install — CHƯA làm, xem docs/task_list.md Phase 6) là các
// row CustomTheme, slug trỏ tới themes/{slug}/ cùng cơ chế root động (services/themeRenderer.ts).
function listBuiltInThemes(): string[] {
  return fs
    .readdirSync(THEMES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const activateSchema = z.object({ slug: z.string().min(1) });

export async function registerThemeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api/themes", { preHandler: requireRole("admin") }, async () => {
    const [config, customThemes] = await Promise.all([
      prisma.themeConfig.findUnique({ where: { id: "singleton" } }),
      prisma.customTheme.findMany({ orderBy: { installedAt: "desc" } }),
    ]);
    const activeTheme = config?.activeTheme ?? "default";

    const builtIn = listBuiltInThemes().map((slug) => ({
      slug,
      name: slug,
      source: "built-in",
      active: slug === activeTheme,
    }));
    const custom = customThemes.map((t) => ({
      slug: t.slug,
      name: t.name,
      source: t.source,
      active: t.slug === activeTheme,
    }));

    return { themes: [...builtIn, ...custom] };
  });

  app.post("/admin/api/themes/activate", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = activateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const { slug } = parsed.data;
    const exists = fs.existsSync(path.join(THEMES_ROOT, slug)) || (await prisma.customTheme.findUnique({ where: { slug } }));
    if (!exists) {
      return reply.code(404).send({ error: "Không tìm thấy theme" });
    }

    const config = await prisma.themeConfig.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", activeTheme: slug },
      update: { activeTheme: slug },
    });

    return { config };
  });
}
