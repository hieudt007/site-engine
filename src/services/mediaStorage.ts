import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";

// Luu file that tren dia VPS o uploads/ (sibling dist/) - KHONG resize/optimize (bo qua sharp,
// tranh phu thuoc native binary kho cai tren VPS - don gian hoa co chu dich). Serve qua
// @fastify/static dang ky trong server.ts (uploads/ -> /uploads/*).
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8MB, khop convention product-images ben lead-base

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

export async function saveUploadedFile(
  buffer: Buffer,
  mimeType: string,
): Promise<{ url: string; filename: string }> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new InvalidUploadError(`Định dạng không hỗ trợ: ${mimeType} (chỉ nhận JPG/PNG/WEBP/GIF)`);
  }
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new InvalidUploadError("File vượt quá 8MB");
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  const filename = `${randomUUID()}.${extensionFor(mimeType)}`;
  await fs.writeFile(path.join(UPLOADS_DIR, filename), buffer);

  return { url: `/uploads/${filename}`, filename };
}

export async function deleteUploadedFile(url: string): Promise<void> {
  const filename = path.basename(url);
  await fs.rm(path.join(UPLOADS_DIR, filename), { force: true });
}
