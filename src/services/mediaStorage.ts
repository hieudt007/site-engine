import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { CacheService } from "./CacheService.js";

// Luu file that tren dia VPS o uploads/ (sibling dist/) - KHONG resize/optimize (bo qua sharp,
// tranh phu thuoc native binary kho cai tren VPS - don gian hoa co chu dich). Serve qua
// @fastify/static dang ky trong server.ts (uploads/ -> /uploads/*).
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Cloudflare R2 (S3-compatible) - cau hinh qua trang Cai dat (SiteConfig.r2*, KHONG dung env, xem
// ghi chu trong schema.prisma) chu khong hard-code o day, vi moi site-engine instance la 1 tenant
// rieng voi bucket/token rieng cua ho. Neu chua cau hinh du 5 truong -> fallback ghi dia local
// (uploadImageLocally/saveUploadedFile cu) nhu truoc gio, KHONG lam gay site chua co R2.
type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; publicUrl: string };

async function getR2Config(): Promise<R2Config | null> {
  const config = await CacheService.getSiteConfig();
  const { r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2BucketName, r2PublicUrl } = config as unknown as {
    r2AccountId?: string | null;
    r2AccessKeyId?: string | null;
    r2SecretAccessKey?: string | null;
    r2BucketName?: string | null;
    r2PublicUrl?: string | null;
  };
  if (!r2AccountId || !r2AccessKeyId || !r2SecretAccessKey || !r2BucketName || !r2PublicUrl) {
    return null;
  }
  return { accountId: r2AccountId, accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey, bucketName: r2BucketName, publicUrl: r2PublicUrl };
}

// 1 S3Client theo 1 bo credential - cache theo accountId+accessKeyId de tu tao lai khi admin doi
// key trong trang Cai dat (khong giu client cu voi secret da thu hoi).
let cachedClient: { key: string; client: S3Client } | null = null;
function getR2Client(r2: R2Config): S3Client {
  const key = `${r2.accountId}:${r2.accessKeyId}`;
  if (cachedClient?.key === key) return cachedClient.client;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  cachedClient = { key, client };
  return client;
}

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

// Day buffer len R2 (key = "{subDir}/{filename}"), tra ve URL cong khai qua r2PublicUrl. Khong
// dat ACL (R2 khong ho tro ACL kieu S3 that - public phai bat qua Public Development URL/Custom
// Domain o cap bucket, xem huong dan trong Cai dat).
async function uploadToR2(r2: R2Config, subDir: string, filename: string, buffer: Buffer, mimeType: string): Promise<string> {
  const key = `${subDir}/${filename}`;
  await getR2Client(r2).send(
    new PutObjectCommand({ Bucket: r2.bucketName, Key: key, Body: buffer, ContentType: mimeType }),
  );
  return `${r2.publicUrl.replace(/\/+$/, "")}/${key}`;
}

export async function saveUploadedFile(
  buffer: Buffer,
  _clientMimeType: string,
): Promise<{ url: string; filename: string; cdnUrl?: string }> {
  const verifiedMimeType = await validateBuffer(buffer);
  const subDir = yearMonthDir();
  const filename = `${randomUUID()}.${extensionFor(verifiedMimeType)}`;

  const r2 = await getR2Config();
  if (r2) {
    const cdnUrl = await uploadToR2(r2, subDir, filename, buffer, verifiedMimeType);
    return { url: cdnUrl, filename, cdnUrl };
  }

  await fs.mkdir(path.join(UPLOADS_DIR, subDir), { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, subDir, filename), buffer);
  return { url: `/uploads/${subDir}/${filename}`, filename };
}

export async function saveAiChatImage(
  buffer: Buffer,
  _clientMimeType: string,
): Promise<{ url: string; filename: string; cdnUrl?: string }> {
  const verifiedMimeType = await validateBuffer(buffer);
  const subDir = "ai-chat";
  const filename = `${randomUUID()}.${extensionFor(verifiedMimeType)}`;

  const r2 = await getR2Config();
  if (r2) {
    const cdnUrl = await uploadToR2(r2, subDir, filename, buffer, verifiedMimeType);
    return { url: cdnUrl, filename, cdnUrl };
  }

  await fs.mkdir(path.join(UPLOADS_DIR, subDir), { recursive: true });
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
  // url dang CDN (khong bat dau bang "/uploads/") -> xoa tren R2 thay vi dia local.
  if (!url.startsWith("/uploads/")) {
    const r2 = await getR2Config();
    if (!r2) return; // URL CDN nhung R2 chua/khong con cau hinh - khong biet key that, bo qua an toan
    const key = url.replace(`${r2.publicUrl.replace(/\/+$/, "")}/`, "");
    if (key.includes("..")) return;
    await getR2Client(r2).send(new DeleteObjectCommand({ Bucket: r2.bucketName, Key: key })).catch(() => {});
    return;
  }

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
