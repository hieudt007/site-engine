import fs from "node:fs/promises";
import path from "node:path";
import { THEME_FILE_CONTRACTS } from "./themeContract.js";
import { prisma } from "../db.js";

const ADDONS_ROOT = path.join(process.cwd(), "src", "addons");

const THEMES_ROOT = path.join(process.cwd(), "themes");

// "Tri nho" cua theme editor AI (khac ThemeChatMessage — do la nhat ky DAY DU cho nguoi xem lai,
// con file nay la ban TOM TAT luon nhet vao MOI prompt AI de giu nhat quan xuyen suot nhieu file/
// nhieu phien chat). Song ngay trong thu muc theme tren dia (khong phai DB) — di theo theme neu
// copy/export, va admin doc/sua tay truc tiep duoc neu muon.
const SECTION_TREE = "## Cây thư mục";
// Doi ten tu "Định hướng mong muốn" - ten cu de bi AI nham voi "Đã áp dụng" (ca 2 doc len giong
// nhau vi cung mo ta mau sac/hanh vi cu the), gay ra tinh trang AI lay noi dung muc nay tra loi
// nhu the la viec VUA lam xong. Ten moi + pham vi thu hep (chi quy uoc TOAN SITE, khong hanh vi
// rieng 1 trang/tinh nang) o buoc phan loai (buildClassifySystemPrompt) giup tach bach ro hon.
const SECTION_INTENT = "## Quy ước & gu thẩm mỹ chung";
const SECTION_APPLIED = "## Đã áp dụng";

function themeMdPath(slug: string): string {
  return path.join(THEMES_ROOT, slug, "THEME.md");
}

// Liet ke gon 18 file .liquid (khong liet ke het 36 file nguon CSS/JS tuong ung - se qua dai,
// ton token moi lan gui vao prompt classify). Mo hinh cap file nguon chi giai thich 1 lan.
async function buildDirectoryTree(): Promise<string> {
  const lines = [
    ...THEME_FILE_CONTRACTS.map((c) => `- ${c.file} — ${c.description}`),
    "",
    "Mỗi file .liquid ở trên có 1 cặp file CSS/JS riêng đi kèm (assets/sources/{tên}.css và .js, " +
      "{tên} = tên file .liquid bỏ đuôi) — chỉ ảnh hưởng đúng trang/component đó. Khi phân loại, chọn file chính liên quan nhất; " +
      "server sẽ tự mở kèm cặp CSS/JS cùng nhóm ở bước sửa.",
    "",
    "Bản đồ chọn file cho trang sản phẩm:",
    "- Sắp xếp/vị trí các khối lớn của trang chi tiết sản phẩm: product-detail.liquid.",
    "- Ảnh/gallery/fallback ảnh sản phẩm: components/product/media.liquid.",
    "- Tên, danh mục, thông tin nhận diện/ngắn của sản phẩm: components/product/info.liquid.",
    "- Giá, biến thể, tồn kho, thêm giỏ, mua ngay, form mua ngay: components/product/purchase.liquid.",
    "- Mô tả dài, thông số, FAQ, custom fields, đánh giá/list review/form review: components/product/content.liquid.",
    "- Upsell/cross-sell/cụm sản phẩm liên quan trong trang chi tiết: components/product/related.liquid.",
    "- Card sản phẩm xuất hiện ở trang chủ, danh sách, danh mục, tìm kiếm, related: components/product/card.liquid.",
    "assets/custom.css và assets/custom.js là file BUILD tự động (gộp + nén từ toàn bộ file nguồn " +
      "CSS/JS) — KHÔNG được chọn 2 file này để sửa trực tiếp.",
  ];

  return lines.join("\n");
}

async function initialThemeMd(): Promise<string> {
  return [
    "# Trí nhớ theme (đọc bởi AI editor mỗi lượt chat — xem services/themeMemory.ts)",
    "",
    SECTION_TREE,
    await buildDirectoryTree(),
    "",
    SECTION_INTENT,
    "(chưa có)",
    "",
    SECTION_APPLIED,
    "(chưa có)",
    "",
  ].join("\n");
}

// Tao THEME.md neu chua co (theme cu tao truoc khi co tinh nang chat, hoac theme moi tu ai-customize
// chua duoc wire tao san) — idempotent, khong ghi de neu da ton tai.
export async function ensureThemeMd(slug: string): Promise<void> {
  const mdPath = themeMdPath(slug);
  try {
    await fs.access(mdPath);
  } catch {
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, await initialThemeMd(), "utf-8");
  }
}

export async function readThemeMd(slug: string): Promise<string> {
  await ensureThemeMd(slug);
  return await fs.readFile(themeMdPath(slug), "utf-8");
}

const KNOWN_HEADINGS = [SECTION_TREE, SECTION_INTENT, SECTION_APPLIED];

// Parse theo DONG, chi coi la heading khi CA DONG (sau khi trim) KHOP Y HET 1 trong 3 ten muc -
// KHONG dung indexOf/tim chuoi con tren toan van ban (tung gay bug that: MEMORY_UPDATE cua AI vo
// tinh nhac lai dung cum "## Đã áp dụng" giua doan van, bi nham la ranh gioi muc, tinh sai vi tri
// roi noi lap ban moi vao cuoi file thay vi thay dung cho -> file phinh to sau nhieu luot chat).
function findHeadingLines(lines: string[]): Map<string, number> {
  const found = new Map<string, number>();
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (KNOWN_HEADINGS.includes(trimmed) && !found.has(trimmed)) {
      found.set(trimmed, i); // chi lay lan xuat hien DAU TIEN cua moi heading
    }
  });
  return found;
}

function extractSection(content: string, heading: string): string {
  const lines = content.split("\n");
  const headingLines = findHeadingLines(lines);
  const start = headingLines.get(heading);
  if (start === undefined) return "";

  const otherStarts = [...headingLines.entries()].filter(([h]) => h !== heading).map(([, i]) => i);
  const end = otherStarts.length ? Math.min(...otherStarts.filter((i) => i > start)) : lines.length;
  const boundedEnd = Number.isFinite(end) ? end : lines.length;
  return lines.slice(start + 1, boundedEnd).join("\n").trim();
}

// Thay THE TOAN BO noi dung 1 muc (khong append) — AI luon tra ve ban cap nhat DAY DU cho muc do,
// tranh file phinh to / thong tin cu-moi mau thuan theo thoi gian (xem quyet dinh thiet ke trong
// cuoc thao luan voi user, khong luu lai o day vi day la code khong phai noi).
async function replaceSection(slug: string, heading: string, newBody: string): Promise<void> {
  const filePath = themeMdPath(slug);
  await ensureThemeMd(slug);
  const current = await fs.readFile(filePath, "utf-8");
  const trimmedBody = newBody.trim() || "(chưa có)";

  const lines = current.split("\n");
  const headingLines = findHeadingLines(lines);
  const start = headingLines.get(heading);

  if (start === undefined) {
    await fs.writeFile(filePath, current.replace(/\n*$/, "\n") + `\n${heading}\n${trimmedBody}\n`, "utf-8");
    return;
  }

  const otherStarts = [...headingLines.entries()].filter(([h]) => h !== heading).map(([, i]) => i);
  const laterStarts = otherStarts.filter((i) => i > start);
  const end = laterStarts.length ? Math.min(...laterStarts) : lines.length;

  const updatedLines = [...lines.slice(0, start + 1), "", trimmedBody, "", ...lines.slice(end)];
  await fs.writeFile(filePath, updatedLines.join("\n"), "utf-8");
}

export async function updateIntentSection(slug: string, newBody: string): Promise<void> {
  await replaceSection(slug, SECTION_INTENT, newBody);
}

export async function updateAppliedSection(slug: string, newBody: string): Promise<void> {
  await replaceSection(slug, SECTION_APPLIED, newBody);
}

export function getIntentSection(content: string): string {
  return extractSection(content, SECTION_INTENT) || "(chưa có)";
}

export function getAppliedSection(content: string): string {
  return extractSection(content, SECTION_APPLIED) || "(chưa có)";
}

// Ban "gon" cho lan goi EDIT — chi Dinh huong + Da ap dung (ngu canh phong cach), BO cay thu muc:
// luc edit da biet chinh xac file nao can sua (do classify quyet dinh roi), khong can biet ve
// 17 trang con lai — gui ca cay thu muc o day chi ton token vo ich.
export function buildEditThemeMemory(content: string): string {
  return [
    SECTION_INTENT,
    getIntentSection(content),
    "",
    SECTION_APPLIED,
    getAppliedSection(content),
  ].join("\n");
}
