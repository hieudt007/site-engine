import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";

// Luu file that tren dia VPS o uploads/ (sibling dist/) - KHONG resize/optimize (bo qua sharp,
// tranh phu thuoc native binary kho cai tren VPS - don gian hoa co chu dich). Serve qua
// @fastify/static dang ky trong server.ts (uploads/ -> /uploads/*).
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// File tai ve san pham so (ebook/phan mem/license...) - luu O RIENG thu muc nay (NGANG HANG
// uploads/, KHONG phai con cua no) vi khong duoc dang ky voi @fastify/static o server.ts - chi doc
// duoc qua routes/public/downloads.ts sau khi kiem tra don hang da thanh toan. Neu vo tinh dat
// trong uploads/ se bi lo cong khai qua /uploads/*, pha vo toan bo muc dich cua route bao ve rieng.
const PRODUCT_DOWNLOADS_DIR = path.join(process.cwd(), "private-uploads", "product-downloads");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8MB, khop convention product-images ben lead-base
const MAX_DOWNLOAD_SIZE_BYTES = 500 * 1024 * 1024; // 500MB - file san pham so co the la ebook/phan mem lon

export class InvalidUploadError extends Error {}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      throw new InvalidUploadError(`Định dạng không hỗ trợ: ${mimeType}`);
  }
}

// Chia thu muc theo nam/thang luc upload (vd uploads/2026/07/) - tranh 1 thu muc phang chua hang
// chuc nghin file sau thoi gian dai dung, de doi soat/backup theo tung thang hon.
function yearMonthDir(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}/${month}`;
}

async function validateBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new InvalidUploadError("File vượt quá 8MB");
  }

  // Khám xét Magic Bytes thực sự của file
  const fileType = await fileTypeFromBuffer(buffer);
  if (!fileType || !ALLOWED_MIME_TYPES.has(fileType.mime)) {
    throw new InvalidUploadError(`Định dạng không hợp lệ hoặc bị mạo danh. (Phát hiện: ${fileType?.mime || "Unknown"})`);
  }

  return fileType.mime;
}

export async function saveUploadedFile(
  buffer: Buffer,
  _clientMimeType: string,
): Promise<{ url: string; filename: string }> {
  const verifiedMimeType = await validateBuffer(buffer);

  const subDir = yearMonthDir();
  await fs.mkdir(path.join(UPLOADS_DIR, subDir), { recursive: true });

  const filename = `${randomUUID()}.${extensionFor(verifiedMimeType)}`;
  await fs.writeFile(path.join(UPLOADS_DIR, subDir, filename), buffer);

  return { url: `/uploads/${subDir}/${filename}`, filename };
}

export async function saveAiChatImage(
  buffer: Buffer,
  _clientMimeType: string,
): Promise<{ url: string; filename: string }> {
  const verifiedMimeType = await validateBuffer(buffer);

  const subDir = "ai-chat";
  await fs.mkdir(path.join(UPLOADS_DIR, subDir), { recursive: true });

  const filename = `${randomUUID()}.${extensionFor(verifiedMimeType)}`;
  await fs.writeFile(path.join(UPLOADS_DIR, subDir, filename), buffer);

  return { url: `/uploads/${subDir}/${filename}`, filename };
}

// Khong gioi han dinh dang nhu anh (file san pham so co the la pdf/zip/epub/exe...) - chi chan
// file rong va qua lon. Ten goc cua khach hang (vd "Ebook.pdf") duoc giu lai trong Content-
// Disposition luc tai (xem routes/public/downloads.ts), KHONG dung lam ten file that tren dia (de
// tranh path traversal/ky tu la) - ten that tren dia luon la {uuid}, anh xa qua originalFilename
// tra ve o day, ProductCache.downloadFilePath chi luu "{subDir}/{uuid}".
export async function saveProductDownloadFile(
  buffer: Buffer,
  originalFilename: string,
): Promise<{ relativePath: string; originalFilename: string }> {
  if (buffer.length === 0) {
    throw new InvalidUploadError("File rỗng");
  }
  if (buffer.length > MAX_DOWNLOAD_SIZE_BYTES) {
    throw new InvalidUploadError("File vượt quá 500MB");
  }

  const subDir = yearMonthDir();
  await fs.mkdir(path.join(PRODUCT_DOWNLOADS_DIR, subDir), { recursive: true });

  const ext = path.extname(originalFilename).slice(0, 20); // gioi han do dai, tranh lam dung
  const filename = `${randomUUID()}${ext}`;
  const relativePath = `${subDir}/${filename}`;
  await fs.writeFile(path.join(PRODUCT_DOWNLOADS_DIR, relativePath), buffer);

  return { relativePath, originalFilename };
}

// Chuyen downloadFilePath (luu trong DB) thanh duong dan tuyet doi tren dia de stream trong
// routes/public/downloads.ts. Chan ".." de phong truong hop gia tri trong DB bi thao tung
// (khong tin tuyet doi input du la server tu sinh ra).
export function resolveProductDownloadPath(relativePath: string): string | null {
  if (relativePath.includes("..")) return null;
  return path.join(PRODUCT_DOWNLOADS_DIR, relativePath);
}

export async function deleteUploadedFile(url: string): Promise<void> {
  // url luu nguyen dang "/uploads/2026/07/{uuid}.ext" (hoac dang phang cu truoc khi co thu muc
  // nam/thang, van xoa dung vi relativePath luc do chi la ten file) - bo tien to "/uploads/" la
  // ra dung duong dan tren dia. Chan "..": phong truong hop du chi server tu sinh url, khong tin
  // tuyet doi input tu DB.
  const relativePath = url.replace(/^\/uploads\//, "");
  if (relativePath.includes("..")) {
    return;
  }
  await fs.rm(path.join(UPLOADS_DIR, relativePath), { force: true });
}
