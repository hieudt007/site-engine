import fs from "node:fs/promises";
import path from "node:path";
import { THEME_FILE_CONTRACTS, THEME_ASSET_FILES } from "./themeContract.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");

// "Tri nho" cua theme editor AI (khac ThemeChatMessage — do la nhat ky DAY DU cho nguoi xem lai,
// con file nay la ban TOM TAT luon nhet vao MOI prompt AI de giu nhat quan xuyen suot nhieu file/
// nhieu phien chat). Song ngay trong thu muc theme tren dia (khong phai DB) — di theo theme neu
// copy/export, va admin doc/sua tay truc tiep duoc neu muon.
const SECTION_TREE = "## Cây thư mục";
const SECTION_INTENT = "## Định hướng mong muốn";
const SECTION_APPLIED = "## Đã áp dụng";

function themeMdPath(slug: string): string {
  return path.join(THEMES_ROOT, slug, "THEME.md");
}

function buildDirectoryTree(): string {
  const lines = [
    ...THEME_FILE_CONTRACTS.map((c) => `- ${c.file} — ${c.description}`),
    ...THEME_ASSET_FILES.map((a) => `- ${a.file} — ${a.notes}`),
  ];
  return lines.join("\n");
}

function initialThemeMd(): string {
  return [
    "# Trí nhớ theme (đọc bởi AI editor mỗi lượt chat — xem services/themeMemory.ts)",
    "",
    SECTION_TREE,
    buildDirectoryTree(),
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
export async function ensureThemeMd(slug: string): Promise<string> {
  const filePath = themeMdPath(slug);
  const existing = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (existing !== null) return existing;
  const content = initialThemeMd();
  await fs.writeFile(filePath, content, "utf-8");
  return content;
}

export async function readThemeMd(slug: string): Promise<string> {
  return ensureThemeMd(slug);
}

function extractSection(content: string, heading: string): string {
  const headings = [SECTION_TREE, SECTION_INTENT, SECTION_APPLIED];
  const start = content.indexOf(heading);
  if (start === -1) return "";
  const afterHeading = start + heading.length;
  const nextHeadingOffsets = headings
    .filter((h) => h !== heading)
    .map((h) => content.indexOf(h, afterHeading))
    .filter((i) => i !== -1);
  const end = nextHeadingOffsets.length ? Math.min(...nextHeadingOffsets) : content.length;
  return content.slice(afterHeading, end).trim();
}

// Thay THE TOAN BO noi dung 1 muc (khong append) — AI luon tra ve ban cap nhat DAY DU cho muc do,
// tranh file phinh to / thong tin cu-moi mau thuan theo thoi gian (xem quyet dinh thiet ke trong
// cuoc thao luan voi user, khong luu lai o day vi day la code khong phai noi).
async function replaceSection(slug: string, heading: string, newBody: string): Promise<void> {
  const filePath = themeMdPath(slug);
  const current = await ensureThemeMd(slug);
  const trimmedBody = newBody.trim() || "(chưa có)";

  const headings = [SECTION_TREE, SECTION_INTENT, SECTION_APPLIED];
  const start = current.indexOf(heading);
  if (start === -1) {
    await fs.writeFile(filePath, current + `\n${heading}\n${trimmedBody}\n`, "utf-8");
    return;
  }
  const afterHeading = start + heading.length;
  const nextHeadingOffsets = headings
    .filter((h) => h !== heading)
    .map((h) => current.indexOf(h, afterHeading))
    .filter((i) => i !== -1);
  const end = nextHeadingOffsets.length ? Math.min(...nextHeadingOffsets) : current.length;

  const updated = current.slice(0, afterHeading) + `\n${trimmedBody}\n\n` + current.slice(end);
  await fs.writeFile(filePath, updated, "utf-8");
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
