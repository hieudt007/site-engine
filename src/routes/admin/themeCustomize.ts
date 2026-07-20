import fs from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_FILE_CONTRACTS, THEME_ASSET_FILES } from "../../services/themeContract.js";
import { generateThemeFile, generateAssetFile } from "../../services/themeGenerator.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");

const customizeSchema = z.object({
  baseSlug: z.string().min(1),
  newSlug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
  newName: z.string().min(1),
  agentId: z.string().min(1),
  stylePrompt: z.string().min(1),
});

const regenerateFileSchema = z.object({
  file: z.string().min(1),
  agentId: z.string().min(1),
  stylePrompt: z.string().min(1),
});

// Tao theme moi bang AI: clone toan bo file tu 1 theme co san lam nen (dam bao LUON co du bo file
// hoat dong duoc, khong bao gio thieu file), roi sinh LAI TUNG FILE mot qua AI theo hop dong
// (services/themeContract.ts). File nao AI sinh khong dat sau MAX_ATTEMPTS lan (themeGenerator.ts)
// thi GIU NGUYEN ban goc tu theme nen (khong ghi de) — theme moi luon la 1 the hoan chinh, khong
// bao gio "nua vari" du 1 vai file AI that bai.
export async function registerThemeCustomizeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/api/themes/ai-customize", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = customizeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const { baseSlug, newSlug, newName, agentId, stylePrompt } = parsed.data;

    const baseDir = path.join(THEMES_ROOT, baseSlug);
    if (!(await fs.stat(baseDir).catch(() => null))?.isDirectory()) {
      return reply.code(404).send({ error: "Không tìm thấy theme gốc" });
    }

    const newDir = path.join(THEMES_ROOT, newSlug);
    if (await fs.stat(newDir).catch(() => null)) {
      return reply.code(409).send({ error: "Slug theme đã tồn tại" });
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return reply.code(404).send({ error: "Không tìm thấy agent" });
    }

    await fs.mkdir(path.join(newDir, "assets"), { recursive: true });

    const results = [];
    for (const contract of THEME_FILE_CONTRACTS) {
      const referenceContent = await fs.readFile(path.join(baseDir, contract.file), "utf-8");
      const result = await generateThemeFile(agent, contract.file, referenceContent, stylePrompt);

      const finalContent = result.ok && result.content ? result.content : referenceContent;
      await fs.writeFile(path.join(newDir, contract.file), finalContent, "utf-8");

      results.push({ file: contract.file, ok: result.ok, errors: result.errors, attempts: result.attempts, usedFallback: !result.ok });
    }

    for (const asset of THEME_ASSET_FILES) {
      const referenceContent = await fs.readFile(path.join(baseDir, asset.file), "utf-8").catch(() => "");
      try {
        const content = await generateAssetFile(agent, asset, referenceContent, stylePrompt);
        await fs.writeFile(path.join(newDir, asset.file), content, "utf-8");
        results.push({ file: asset.file, ok: true, errors: [], attempts: 1, usedFallback: false });
      } catch (err) {
        await fs.writeFile(path.join(newDir, asset.file), referenceContent, "utf-8");
        results.push({ file: asset.file, ok: false, errors: [(err as Error).message], attempts: 1, usedFallback: true });
      }
    }

    const theme = await prisma.customTheme.create({
      data: { slug: newSlug, name: newName, source: "agent-generated" },
    });

    return reply.code(201).send({ theme, results });
  });

  // Sinh lai DUY NHAT 1 file cua 1 CustomTheme da co (khong ap dung cho theme built-in — built-in
  // la "nguon sach" de lam nen cho theme khac, khong nen bi AI sua tai cho). Dung chinh NOI DUNG
  // HIEN TAI cua file do lam tham chieu (khong phai theme goc luc tao) — de "sinh lai nhung xanh
  // hon" xay dung tiep tren ket qua truoc, khong quay ve tu dau moi lan.
  app.post<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/ai-regenerate-file",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = regenerateFileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const { file, agentId, stylePrompt } = parsed.data;

      const customTheme = await prisma.customTheme.findUnique({ where: { slug: request.params.slug } });
      if (!customTheme) {
        return reply.code(404).send({ error: "Chỉ sinh lại được cho theme do AI tạo (không áp dụng theme có sẵn)" });
      }

      const filePath = path.join(THEMES_ROOT, request.params.slug, file);
      const currentContent = await fs.readFile(filePath, "utf-8").catch(() => null);
      if (currentContent === null) {
        return reply.code(404).send({ error: "Không tìm thấy file trong theme này" });
      }

      const agent = await prisma.agent.findUnique({ where: { id: agentId } });
      if (!agent) {
        return reply.code(404).send({ error: "Không tìm thấy agent" });
      }

      const asset = THEME_ASSET_FILES.find((a) => a.file === file);
      if (asset) {
        try {
          const content = await generateAssetFile(agent, asset, currentContent, stylePrompt);
          await fs.writeFile(filePath, content, "utf-8");
          return { ok: true, errors: [], attempts: 1 };
        } catch (err) {
          return { ok: false, errors: [(err as Error).message], attempts: 1 };
        }
      }

      const result = await generateThemeFile(agent, file, currentContent, stylePrompt);
      if (result.ok && result.content) {
        await fs.writeFile(filePath, result.content, "utf-8");
      }

      return { ok: result.ok, errors: result.errors, attempts: result.attempts };
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/files",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const dir = path.join(THEMES_ROOT, request.params.slug);
      if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) {
        return reply.code(404).send({ error: "Không tìm thấy theme" });
      }
      return {
        files: [
          ...THEME_FILE_CONTRACTS.map((c) => ({ file: c.file, description: c.description })),
          ...THEME_ASSET_FILES.map((a) => ({ file: a.file, description: a.contentType.toUpperCase() + " tùy chỉnh" })),
        ],
      };
    },
  );
}
