import fs from "node:fs";
import fsp from "node:fs/promises";
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

// "default" la theme khung tho (chi co Cay thu muc Liquid + layout 1200px, khong style) - dung LAM
// NEN de clone khi tao theme moi hoan toan (xem themeCustomize.ts), khong dung de hien thi truc
// tiep tren site (se rat xau vi khong co CSS). An khoi luoi chon + chan active qua UI/API, nhung
// van con tren dia de lam nguon clone.
const HIDDEN_FROM_GRID_SLUGS = new Set(["default"]);

// screenshot.png la TUY CHON (khong bat buoc voi theme built-in lan CustomTheme AI sinh - AI
// khong duoc yeu cau ve anh) - UI (/admin/settings/theme) chi hien <img> khi co, an han khi
// khong co, tranh vo layout vi broken image icon.
function hasScreenshot(slug: string): boolean {
  return fs.existsSync(path.join(THEMES_ROOT, slug, "screenshot.png"));
}

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
      hasScreenshot: hasScreenshot(slug),
      hiddenFromGrid: HIDDEN_FROM_GRID_SLUGS.has(slug),
    }));
    const custom = customThemes.map((t) => ({
      slug: t.slug,
      name: t.name,
      source: t.source,
      active: t.slug === activeTheme,
      hasScreenshot: hasScreenshot(t.slug),
    }));

    return { themes: [...builtIn, ...custom] };
  });

  app.post("/admin/api/themes/activate", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = activateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const { slug } = parsed.data;
    if (HIDDEN_FROM_GRID_SLUGS.has(slug)) {
      return reply.code(422).send({ error: "Theme này chỉ dùng làm nền để tạo theme mới, không thể dùng trực tiếp cho site." });
    }
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

  // Chi xoa duoc CustomTheme (agent-generated) - theme built-in la nguon sach dong goi cung app,
  // khong cho xoa qua UI. Chan xoa theme dang active de tranh site public mat theme dang dung
  // (phai doi sang theme khac truoc). Xoa ca thu muc tren dia lan ThemeChatMessage lien quan.
  app.delete<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { slug } = request.params;
      const customTheme = await prisma.customTheme.findUnique({ where: { slug } });
      if (!customTheme) {
        return reply.code(404).send({ error: "Chỉ xoá được theme do AI tạo (không áp dụng theme có sẵn)" });
      }

      const config = await prisma.themeConfig.findUnique({ where: { id: "singleton" } });
      if (config?.activeTheme === slug) {
        return reply.code(422).send({ error: "Không thể xoá theme đang dùng — đổi sang theme khác trước." });
      }

      await fsp.rm(path.join(THEMES_ROOT, slug), { recursive: true, force: true });
      await prisma.themeChatMessage.deleteMany({ where: { slug } });
      await prisma.customTheme.delete({ where: { slug } });

      return { success: true };
    },
  );
}
