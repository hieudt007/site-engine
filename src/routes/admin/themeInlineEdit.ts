import fs from "node:fs/promises";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { THEME_FILE_CONTRACTS, pairedSourceFiles } from "../../services/themeContract.js";
import { validateThemeFile } from "../../services/themeValidator.js";
import { rebuildThemeAssets } from "../../services/themeAssetBundler.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");
const LIQUID_FILES = new Set(THEME_FILE_CONTRACTS.map((c) => c.file));

// Sua truc tiep tren khung xem truoc (click-to-edit, giong kieu leadbase lam voi landing page) -
// CHI cho 5 viec don gian: doi text/anh CO DINH trong file .liquid (tim-thay CHINH XAC 1 lan
// trong source, khac 0/nhieu lan la du lieu dong tu CSDL — KHONG duoc sua, se pha vong lap/bien
// Liquid) va doi mau/font-size/kich thuoc anh (luon an toan, ghi thang vao CSS rieng cua trang,
// khong dung AI). Viec phuc tap hon (bo cuc, tinh nang...) van phai qua chat AI (themeChat.ts).
const replaceTextSchema = z.object({
  file: z.string().min(1),
  oldText: z.string().min(1),
  newText: z.string(),
});

const checkStaticSchema = z.object({
  file: z.string().min(1),
  text: z.string().min(1),
});

const styleSchema = z.object({
  file: z.string().min(1), // ten file .liquid (vd "home.liquid") - suy ra dung CSS nguon cua trang do
  selector: z.string().min(1).max(300),
  declarations: z.record(z.string(), z.string()),
});

// Whitelist CHAT che - khong cho ghi CSS property tuy y (tranh injection/pha layout ngoai y).
const ALLOWED_CSS_PROPS = new Set(["color", "font-size", "width", "height", "background-image"]);
const CSS_VALUE_RE = /^[a-zA-Z0-9#.,%()\s-]{1,80}$/; // hex/px/%/keyword/rgb(...) - khong cho url()/;/{}
// background-image rieng: CHI cho dung 1 dang url("...") voi duong dan noi bo (/uploads/...) hoac
// http(s) tuyet doi - chan url(javascript:...) va cac chuoi thoat ky tu la (") pha vo rule CSS.
const BG_IMAGE_VALUE_RE = /^url\("(\/uploads\/[a-zA-Z0-9/_.-]+|https?:\/\/[a-zA-Z0-9/_.:%?=&-]+)"\)$/;

function isValidCssValue(prop: string, value: string): boolean {
  if (prop === "background-image") return BG_IMAGE_VALUE_RE.test(value);
  return CSS_VALUE_RE.test(value);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Cac HTML entity thuong gap co the khac giua source (.liquid, dang encode) va textContent tren
// trinh duyet (da decode) - build 1 nhom alternation cho tung ky tu nay khi dung lam pattern tim.
const ENTITY_ALTS: Record<string, string> = {
  "&": "(?:&amp;|&)",
  '"': '(?:&quot;|")',
  "'": "(?:&#0?39;|&apos;|')",
  "<": "(?:&lt;|<)",
  ">": "(?:&gt;|>)",
};

// oldText tu browser (textContent, da decode entity, whitespace co the bi trinh duyet render
// gop/xuong dong khac voi cach source .liquid dang format nhieu dong/thut le) - so khop CHINH XAC
// tung ky tu se hay truot. Build 1 regex: nhom khoang trang lien tiep thanh \s+, cac ky tu entity
// nhay cam thanh alternation - van giu chat ve NOI DUNG, chi noi long ve FORMAT hien thi.
function buildFlexiblePattern(oldText: string): RegExp {
  const collapsed = oldText.trim().replace(/\s+/g, " ");
  let pattern = "";
  for (const ch of collapsed) {
    if (ch === " ") {
      pattern += "\\s+";
    } else if (ENTITY_ALTS[ch]) {
      pattern += ENTITY_ALTS[ch];
    } else {
      pattern += escapeRegex(ch);
    }
  }
  return new RegExp(pattern, "g");
}

// Tim CHINH XAC 1 cho khop (khong linh hoat -> tra null, khop >1 cho -> tra null, tranh sua nham
// cho nhap nhang) - tra ve vi tri + do dai THAT trong file de thay dung doan, khong lam hong
// format/whitespace xung quanh.
function findUniqueMatch(content: string, oldText: string): { index: number; length: number } | null {
  const regex = buildFlexiblePattern(oldText);
  const matches = [...content.matchAll(regex)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  return { index: m.index, length: m[0].length };
}

export async function registerThemeInlineEditRoutes(app: FastifyInstance): Promise<void> {
  // Goi TRUOC khi cho phep bam sua (frontend goi luc mo popup/dblclick) - tra ve co phai noi dung
  // CO DINH hay khong, dua dung 1 nguon that (noi dung file that) thay vi doan qua cau truc DOM
  // (vd chi co 1 san pham trong CSDL thi vong lap {% for %} khong con "lap lai" de nhan ra qua so
  // luong phan tu giong nhau nua - phai hoi thang server moi chac chan).
  app.post<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/inline-edit/check-static",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = checkStaticSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const { slug } = request.params;
      const { file, text } = parsed.data;
      if (!LIQUID_FILES.has(file)) {
        return reply.code(400).send({ error: "File không hợp lệ" });
      }
      const filePath = path.join(THEMES_ROOT, slug, file);
      const content = await fs.readFile(filePath, "utf-8").catch(() => null);
      if (content === null) {
        return reply.code(404).send({ error: "Không tìm thấy file" });
      }
      return { static: findUniqueMatch(content, text) !== null };
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/inline-edit/replace-text",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = replaceTextSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const { slug } = request.params;
      const { file, oldText, newText } = parsed.data;

      if (!LIQUID_FILES.has(file)) {
        return reply.code(400).send({ error: "File không hợp lệ" });
      }
      const customTheme = await prisma.customTheme.findUnique({ where: { slug } });
      if (!customTheme) {
        return reply.code(404).send({ error: "Chỉ sửa được theme do AI tạo" });
      }

      const filePath = path.join(THEMES_ROOT, slug, file);
      const content = await fs.readFile(filePath, "utf-8").catch(() => null);
      if (content === null) {
        return reply.code(404).send({ error: "Không tìm thấy file" });
      }

      const match = findUniqueMatch(content, oldText);
      if (!match) {
        const anyMatches = [...content.matchAll(buildFlexiblePattern(oldText))].length;
        return reply.code(422).send({
          error:
            anyMatches === 0
              ? "Không tìm thấy nội dung này trong file — có thể đây là dữ liệu thật (sản phẩm/bài viết), không sửa trực tiếp được. Dùng chat để nhờ AI sửa."
              : "Nội dung này xuất hiện nhiều chỗ trong file, không sửa trực tiếp an toàn được. Dùng chat để nhờ AI sửa.",
        });
      }

      const newContent = content.slice(0, match.index) + newText + content.slice(match.index + match.length);
      const validation = await validateThemeFile(file, newContent);
      if (!validation.ok) {
        return reply.code(422).send({ error: "Sửa xong file sẽ lỗi cấu trúc bắt buộc: " + validation.errors.join("; ") });
      }

      await fs.writeFile(filePath, newContent, "utf-8");
      return { ok: true };
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/admin/api/themes/:slug/inline-edit/style",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const parsed = styleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }
      const { slug } = request.params;
      const { file, selector, declarations } = parsed.data;

      if (!LIQUID_FILES.has(file)) {
        return reply.code(400).send({ error: "File không hợp lệ" });
      }
      const entries = Object.entries(declarations).filter(([prop]) => ALLOWED_CSS_PROPS.has(prop));
      if (!entries.length) {
        return reply.code(422).send({ error: "Không có thuộc tính CSS hợp lệ" });
      }
      for (const [prop, value] of entries) {
        if (!isValidCssValue(prop, value)) {
          return reply.code(422).send({ error: "Giá trị CSS không hợp lệ" });
        }
      }

      const customTheme = await prisma.customTheme.findUnique({ where: { slug } });
      if (!customTheme) {
        return reply.code(404).send({ error: "Chỉ sửa được theme do AI tạo" });
      }

      const { css: cssFile } = pairedSourceFiles(file);
      const cssPath = path.join(THEMES_ROOT, slug, cssFile);
      const current = await fs.readFile(cssPath, "utf-8").catch(() => "");
      const rule = `${selector} { ${entries.map(([k, v]) => `${k}: ${v};`).join(" ")} }\n`;
      await fs.mkdir(path.dirname(cssPath), { recursive: true });
      await fs.writeFile(cssPath, current.replace(/\n*$/, "\n") + rule, "utf-8");

      await rebuildThemeAssets(slug);
      return { ok: true };
    },
  );
}
