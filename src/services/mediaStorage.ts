import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import AdmZip from "adm-zip";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { CacheService } from "./CacheService.js";
import { prisma } from "../db.js";
import { rewriteMediaUrlReferences } from "./mediaUsage.js";
import { decryptNodeString } from "../nodeCrypt.js";

// Luu file that tren dia VPS o uploads/ (sibling dist/), serve qua @fastify/static dang ky trong
// server.ts (uploads/ -> /uploads/*). Anh duoc toi uu (resize + nen) bang sharp truoc khi luu -
// xem optimizeImageBuffer().
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// Toi uu anh: tu xoay theo EXIF, resize GIU TY LE ve toi da 1920px (chieu dai nhat), khong phong
// to anh nho hon, nen lai theo dung dinh dang goc (quality ~82, can bang chat luong/dung luong).
// Bo qua GIF (resize se lam mat animation, giu nguyen buffer goc).
const MAX_DIMENSION = 1920;
async function optimizeImageBuffer(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === "image/gif") return buffer;

  let pipeline = sharp(buffer).rotate().resize(MAX_DIMENSION, MAX_DIMENSION, { fit: "inside", withoutEnlargement: true });
  if (mimeType === "image/png") pipeline = pipeline.png({ quality: 82 });
  else if (mimeType === "image/webp") pipeline = pipeline.webp({ quality: 82 });
  else pipeline = pipeline.jpeg({ quality: 82 });

  return pipeline.toBuffer();
}

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
  // r2AccessKeyId/r2SecretAccessKey duoc ma hoa (encryptNodeString) truoc khi luu DB (xem
  // routes/admin/settings.ts) - giai ma o day, diem DUY NHAT thuc su can gia tri that de goi R2.
  return {
    accountId: r2AccountId,
    accessKeyId: decryptNodeString(r2AccessKeyId),
    secretAccessKey: decryptNodeString(r2SecretAccessKey),
    bucketName: r2BucketName,
    publicUrl: r2PublicUrl,
  };
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
  const optimized = await optimizeImageBuffer(buffer, verifiedMimeType);
  const subDir = yearMonthDir();
  const filename = `${randomUUID()}.${extensionFor(verifiedMimeType)}`;

  const r2 = await getR2Config();
  if (r2) {
    const cdnUrl = await uploadToR2(r2, subDir, filename, optimized, verifiedMimeType);
    return { url: cdnUrl, filename, cdnUrl };
  }

  await fs.mkdir(path.join(UPLOADS_DIR, subDir), { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, subDir, filename), optimized);
  return { url: `/uploads/${subDir}/${filename}`, filename };
}

export async function saveAiChatImage(
  buffer: Buffer,
  _clientMimeType: string,
): Promise<{ url: string; filename: string; cdnUrl?: string }> {
  const verifiedMimeType = await validateBuffer(buffer);
  const optimized = await optimizeImageBuffer(buffer, verifiedMimeType);
  const subDir = "ai-chat";
  const filename = `${randomUUID()}.${extensionFor(verifiedMimeType)}`;

  const r2 = await getR2Config();
  if (r2) {
    const cdnUrl = await uploadToR2(r2, subDir, filename, optimized, verifiedMimeType);
    return { url: cdnUrl, filename, cdnUrl };
  }

  await fs.mkdir(path.join(UPLOADS_DIR, subDir), { recursive: true });
  await fs.writeFile(path.join(UPLOADS_DIR, subDir, filename), optimized);
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

// Trang thai de quyet dinh co hien nut "Chuyen anh cu sang R2" tren UI Media hay khong: chi hien
// khi R2 da cau hinh XONG VA da co it nhat 1 anh that su len duoc R2 (cdnMediaCount > 0) - tranh
// cho admin bam migrate hang loat khi con chua ro cau hinh co chay dung khong (chua upload thu
// anh nao thanh cong qua R2 lan nao).
export async function getR2MigrationStatus(): Promise<{ r2Configured: boolean; cdnMediaCount: number; localMediaCount: number }> {
  const r2 = await getR2Config();
  const [cdnMediaCount, localMediaCount] = await Promise.all([
    prisma.media.count({ where: { cdnUrl: { not: null } } }),
    prisma.media.count({ where: { cdnUrl: null } }),
  ]);
  return { r2Configured: Boolean(r2), cdnMediaCount, localMediaCount };
}

// Chuyen (khong phai sao chep) toan bo Media dang luu local (cdnUrl null) len R2: doc file that
// tren dia, day len R2 GIU NGUYEN subDir/filename hien co (de khong doi duong dan trong bai
// viet/san pham dang tham chieu {subDir}/{filename} kieu cu, chi doi domain), cap nhat lai
// url/cdnUrl trong DB, roi xoa file local sau khi upload thanh cong (giai phong dia VPS - dung
// muc dich "chuyen" thay vi "sao chep").
export async function migrateLocalMediaToR2(): Promise<{ migrated: number; failed: Array<{ id: string; filename: string; error: string }> }> {
  const r2 = await getR2Config();
  if (!r2) {
    throw new InvalidUploadError("Chưa cấu hình đủ Cloudflare R2 trong Cài đặt.");
  }

  const localMedia = await prisma.media.findMany({ where: { cdnUrl: null } });
  let migrated = 0;
  const failed: Array<{ id: string; filename: string; error: string }> = [];

  for (const media of localMedia) {
    try {
      if (!media.url.startsWith("/uploads/")) continue; // da khong phai local (du cdnUrl dang null - du phong)
      const relativePath = media.url.replace(/^\/uploads\//, "");
      if (relativePath.includes("..")) throw new Error("Đường dẫn không hợp lệ");

      const buffer = await fs.readFile(path.join(UPLOADS_DIR, relativePath));
      const subDir = path.posix.dirname(relativePath);
      const filename = path.posix.basename(relativePath);
      const cdnUrl = await uploadToR2(r2, subDir, filename, buffer, media.mimeType);

      // Doi het cac cho dang tham chieu url cu (coverImage/body/imageUrls/logo...) sang url moi
      // TRUOC khi xoa file local, de khong bao gio co khoang thoi gian anh gay tren site that.
      await rewriteMediaUrlReferences(media.url, cdnUrl);
      await prisma.media.update({ where: { id: media.id }, data: { url: cdnUrl, cdnUrl } });
      await fs.rm(path.join(UPLOADS_DIR, relativePath), { force: true });
      migrated++;
    } catch (err) {
      failed.push({ id: media.id, filename: media.filename, error: err instanceof Error ? err.message : "Lỗi không xác định" });
    }
  }

  return { migrated, failed };
}

// Import hang loat anh tu 1 file .zip (vd nen thu muc "wp-content/uploads" tai ve tu site
// WordPress cu) - giai nen thang vao uploads/ CUA SERVER NAY, giu nguyen cau truc con "{nam}/
// {thang}/{ten file}" cua WordPress khi phat hien duoc (bo phan tien to "wp-content/uploads/"),
// de URL sinh ra ("/uploads/{nam}/{thang}/{file}") KHOP CHINH XAC voi URL da duoc
// localizeWpContentUrls() rewrite luc import file .xml (xem wordpressImport.ts) - anh se hien
// dung ngay ma khong can doi chieu/thay the gi them.
export interface ZipImportSummary {
  imported: number;
  skipped: number;
  rejected: { name: string; reason: string }[];
}

const MAX_ZIP_SIZE_BYTES = 300 * 1024 * 1024; // 300MB file .zip nen (anh da nen san nen it khi can hon)
const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1GB tong dung luong sau giai nen - chan "zip bomb"
const MAX_ZIP_ENTRIES = 20000;

// Chi lay phan duong dan SAU "wp-content/uploads/" (neu co) de giu nguyen cau truc nam/thang goc
// cua WordPress; neu khong co (file .zip nen tay, khong theo cau truc WP) thi bo tien to "uploads/"
// thua (neu co) roi dung phan con lai. path.posix.normalize() + kiem tra ".." /duong dan tuyet doi
// de chan "zip slip" (entry ten kieu "../../etc/passwd" ghi de file ngoai uploads/ - lo hong that
// da biet cua dinh dang zip, khong tin tuyet doi ten entry ben trong file nguoi dung tai len).
function safeRelativePathFromZipEntry(entryName: string): string | null {
  const normalized = entryName.replace(/\\/g, "/");
  const marker = "wp-content/uploads/";
  const idx = normalized.toLowerCase().indexOf(marker);
  const afterMarker = idx >= 0 ? normalized.slice(idx + marker.length) : normalized.replace(/^\/?(uploads\/)?/i, "");
  const posixNormalized = path.posix.normalize(afterMarker);
  if (!posixNormalized || posixNormalized === "." || posixNormalized.startsWith("..") || path.posix.isAbsolute(posixNormalized)) {
    return null;
  }
  return posixNormalized;
}

export async function importMediaZip(buffer: Buffer, uploadedByUserId: number): Promise<ZipImportSummary> {
  if (buffer.length > MAX_ZIP_SIZE_BYTES) {
    throw new InvalidUploadError("File .zip vượt quá 300MB");
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new InvalidUploadError("Không đọc được file - kiểm tra đây có đúng là file .zip không.");
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new InvalidUploadError(`File .zip chứa quá nhiều file (tối đa ${MAX_ZIP_ENTRIES}).`);
  }

  const summary: ZipImportSummary = { imported: 0, skipped: 0, rejected: [] };
  let totalUncompressed = 0;

  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, "/");
    const baseName = path.posix.basename(entryName);
    // Rac he thong thuong gap trong zip nen tu macOS/Windows - bo qua am tham, khong tinh la loi.
    if (entryName.includes("__MACOSX/") || baseName.startsWith(".") || baseName === "Thumbs.db") continue;

    const relativePath = safeRelativePathFromZipEntry(entryName);
    if (!relativePath) {
      summary.rejected.push({ name: entryName, reason: "Đường dẫn không hợp lệ" });
      continue;
    }

    totalUncompressed += entry.header.size;
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new InvalidUploadError("Tổng dung lượng sau giải nén vượt quá 1GB, đã huỷ import.");
    }

    let raw: Buffer;
    try {
      raw = entry.getData();
    } catch {
      summary.rejected.push({ name: entryName, reason: "Không giải nén được entry này" });
      continue;
    }

    // Kham xet Magic Bytes that su (khong tin duoi file trong ten entry) - dung y het validateBuffer()
    // dung cho upload tay tung anh, chan file .php/.exe doi ten thanh .jpg nhet vao zip.
    let mimeType: string;
    try {
      mimeType = await validateBuffer(raw);
    } catch (err) {
      summary.rejected.push({ name: entryName, reason: err instanceof Error ? err.message : "Định dạng không hợp lệ" });
      continue;
    }

    const url = `/uploads/${relativePath}`;
    const existing = await prisma.media.findFirst({ where: { url } });
    if (existing) {
      summary.skipped++;
      continue;
    }

    try {
      const optimized = await optimizeImageBuffer(raw, mimeType);
      const destPath = path.join(UPLOADS_DIR, relativePath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, optimized);

      await prisma.media.create({
        data: { filename: baseName, url, mimeType, size: optimized.length, uploadedByUserId },
      });
      summary.imported++;
    } catch (err) {
      summary.rejected.push({ name: entryName, reason: err instanceof Error ? err.message : "Lỗi không xác định" });
    }
  }

  return summary;
}
