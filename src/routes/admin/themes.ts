import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_ASSET_FILES, THEME_BUNDLE_OUTPUTS, THEME_FILE_CONTRACTS } from "../../services/themeContract.js";
import { validateThemeFile } from "../../services/themeValidator.js";
import { rebuildThemeAssets } from "../../services/themeAssetBundler.js";
import { ensureThemeMd } from "../../services/themeMemory.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

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
const importThemeSchema = z.object({
  slug: z.string().regex(SLUG_RE, "Slug chỉ gồm chữ thường, số và dấu gạch ngang, dài 3-50 ký tự"),
  name: z.string().trim().min(1).max(120).optional(),
  mode: z.enum(["create", "update"]).default("create"),
  activate: z.boolean().default(false),
  files: z.record(z.string()),
});

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

function normalizeThemePath(file: string): string | null {
  const normalized = file.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) return null;
  return normalized;
}

function allowedImportFiles(): Set<string> {
  return new Set([
    ...THEME_FILE_CONTRACTS.map((c) => c.file),
    ...THEME_ASSET_FILES.map((a) => a.file),
    "THEME.md",
    "theme.json",
    "screenshot.png",
  ]);
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

async function validateImportedThemeDir(themeDir: string): Promise<string[]> {
  const errors: string[] = [];
  for (const contract of THEME_FILE_CONTRACTS) {
    const filePath = path.join(themeDir, contract.file);
    const source = await fsp.readFile(filePath, "utf-8").catch(() => null);
    if (source === null) {
      errors.push(`Thiếu file bắt buộc: ${contract.file}`);
      continue;
    }
    const result = await validateThemeFile(contract.file, source);
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `${contract.file}: ${error}`));
    }
  }
  return errors;
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

  app.post("/admin/api/themes/import", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = importThemeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const { slug, mode, activate } = parsed.data;
    const name = parsed.data.name?.trim() || slug;
    if (HIDDEN_FROM_GRID_SLUGS.has(slug)) {
      return reply.code(422).send({ error: "Không thể import đè theme hệ thống." });
    }

    const allowedFiles = allowedImportFiles();
    const normalizedFiles = new Map<string, string>();
    for (const [rawFile, content] of Object.entries(parsed.data.files)) {
      const file = normalizeThemePath(rawFile);
      if (!file || !allowedFiles.has(file) || THEME_BUNDLE_OUTPUTS.includes(file)) {
        return reply.code(422).send({ error: `File không được phép import: ${rawFile}` });
      }
      normalizedFiles.set(file, content);
    }

    const themeDir = path.join(THEMES_ROOT, slug);
    const existsOnDisk = fs.existsSync(themeDir);
    const existsInDb = await prisma.customTheme.findUnique({ where: { slug } });
    if (mode === "create" && (existsOnDisk || existsInDb)) {
      return reply.code(409).send({ error: "Slug theme đã tồn tại." });
    }
    if (mode === "update" && !existsOnDisk && !existsInDb) {
      return reply.code(404).send({ error: "Không tìm thấy theme để cập nhật." });
    }

    const tmpDir = path.join(THEMES_ROOT, `.import-${slug}-${Date.now()}`);
    try {
      if (mode === "update" && existsOnDisk) {
        await copyDir(themeDir, tmpDir);
      } else {
        await fsp.mkdir(tmpDir, { recursive: true });
      }

      for (const [file, content] of normalizedFiles) {
        const filePath = path.join(tmpDir, file);
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, content, "utf-8");
      }

      const validationErrors = await validateImportedThemeDir(tmpDir);
      if (validationErrors.length) {
        return reply.code(422).send({ error: "Theme không hợp lệ", errors: validationErrors });
      }

      await fsp.rm(themeDir, { recursive: true, force: true });
      await fsp.rename(tmpDir, themeDir);
      await ensureThemeMd(slug);
      await rebuildThemeAssets(slug);

      const theme = await prisma.customTheme.upsert({
        where: { slug },
        create: { slug, name, source: "uploaded" },
        update: { name, source: "uploaded" },
      });

      if (activate) {
        await prisma.themeConfig.upsert({
          where: { id: "singleton" },
          create: { id: "singleton", activeTheme: slug },
          update: { activeTheme: slug },
        });
      }

      return reply.code(mode === "create" ? 201 : 200).send({ theme, activated: activate });
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
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
