import fs from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_FILE_CONTRACTS } from "../../services/themeContract.js";
import { ensureThemeMd } from "../../services/themeMemory.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");

const customizeSchema = z.object({
  baseSlug: z.string().min(1),
  newSlug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug chỉ gồm chữ thường/số, cách nhau bằng -"),
  newName: z.string().min(1),
});

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

// Tao theme moi: CHI clone nguyen ven file tu 1 theme co san lam nen (dam bao luon co du bo file
// hoat dong duoc ngay) + tao THEME.md (services/themeMemory.ts) - KHONG goi AI o buoc nay. Sua theo
// phong cach mong muon la viec cua trang editor rieng (/admin/themes/:slug/edit) qua chat AI, sau
// khi da vao trong do - tach lam 2 buoc rieng cho nhanh (tao theme la thao tac file thuan, khong
// cho AI phan hoi vai phut), thay vi buoc tao phai kem 1 lan goi AI cho tung file nhu truoc.
export async function registerThemeCustomizeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/api/themes/ai-customize", { preHandler: requireRole("admin") }, async (request, reply) => {
    const parsed = customizeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }
    const { baseSlug, newSlug, newName } = parsed.data;

    const baseDir = path.join(THEMES_ROOT, baseSlug);
    if (!(await fs.stat(baseDir).catch(() => null))?.isDirectory()) {
      return reply.code(404).send({ error: "Không tìm thấy theme gốc" });
    }

    const newDir = path.join(THEMES_ROOT, newSlug);
    if (await fs.stat(newDir).catch(() => null)) {
      return reply.code(409).send({ error: "Slug theme đã tồn tại" });
    }

    // Neu buoc nao sau khi clone that bai, xoa sach thu muc vua tao - tranh de lai folder mo coi
    // khong khop row DB nao (se bi listBuiltInThemes() nham thanh theme "co san", khong xoa duoc
    // qua UI - dung bai hoc tu 2 folder rac lead-base/lead-base-1 gap trong qua trinh test).
    try {
      await copyDir(baseDir, newDir);
      await ensureThemeMd(newSlug);
      const theme = await prisma.customTheme.create({
        data: { slug: newSlug, name: newName, source: "agent-generated" },
      });
      // Cau hoi mo dau khac nhau tuy nguon clone: tu "default" (khung tho, chua co gi) can hoi CA
      // giao dien lan tinh nang de AI biet bat dau tu dau; clone tu theme khac (da co san noi
      // dung/style) chi can hoi MUON SUA GI - khong hoi lai tu dau nhung thu da co san.
      const welcomeMessage =
        baseSlug === "default"
          ? "Theme này đang trống, mình cần biết thêm để bắt đầu thiết kế:\n" +
            "1) Bạn muốn giao diện trông như thế nào (ngành hàng, màu sắc, phong cách)?\n" +
            "2) Có tính năng đặc biệt nào cần chú ý không?"
          : "Bạn muốn mình sửa phần giao diện nào, trang nào, hay tính năng gì?";
      await prisma.themeChatMessage.create({ data: { slug: newSlug, role: "assistant", content: welcomeMessage } });
      return reply.code(201).send({ theme });
    } catch (err) {
      await fs.rm(newDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  });

  app.get<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/files",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const dir = path.join(THEMES_ROOT, request.params.slug);
      if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) {
        return reply.code(404).send({ error: "Không tìm thấy theme" });
      }
      // Sidebar chi hien 18 trang .liquid - file CSS/JS rieng cua tung trang (assets/sources/) va
      // 2 file build (assets/custom.css/js) la plumbing tu dong, khong can bam chon thu cong.
      return {
        files: THEME_FILE_CONTRACTS.map((c) => ({ file: c.file, description: c.description })),
      };
    },
  );
}
