import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export type RevisionEntityType = "Post" | "Page" | "Product";

export interface FieldDiff {
  field: string;
  label: string;
  old: unknown;
  new: unknown;
}

// Nhan hien thi tieng Viet cho tung field noi dung theo doi boi Revision — CHI can khai bao field
// nao THUC SU duoc snapshot (xem cac lenh goi saveRevision trong routes/admin/{posts,pages,products}.ts),
// field khong co trong danh sach nay (vd categoryIds, topicId — quan he, khong phai field don) tu
// dong bi diffFields() bo qua, khong loi.
const FIELD_LABELS: Record<string, string> = {
  title: "Tiêu đề",
  slug: "Đường dẫn",
  body: "Nội dung",
  excerpt: "Tóm tắt",
  coverImage: "Ảnh bìa",
  seo: "SEO",
  password: "Mật khẩu",
  customFields: "Trường tùy biến",
  layoutMode: "Định dạng trang",
  name: "Tên",
  description: "Mô tả",
  imageUrls: "Ảnh sản phẩm",
};

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  return JSON.stringify(a) === JSON.stringify(b);
}

// So sanh gia tri HIEN TAI (truoc khi update) voi gia tri MOI GUI LEN (payload PATCH) theo TUNG
// FIELD — khac voi cach lead-base lam (Observer/Controller/OrderUpdateTool liet ke cung field
// trung lap o 3 noi, xem trao doi luc thiet ke), o day dung 1 vong lap generic qua field co trong
// payload, khop voi field nao co trong snapshot thi so sanh. Field khong duoc gui trong payload
// nay (PATCH chi sua rieng vd customFields qua modal) tu nhien khong xuat hien trong payload nen
// khong bi coi la "thay doi" — dung y nghia "field nao THAT SU co mat trong request nay".
export function diffFields(current: Record<string, unknown>, incoming: Record<string, unknown>): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const field of Object.keys(incoming)) {
    if (!(field in current)) continue;
    if (!valuesEqual(current[field], incoming[field])) {
      diffs.push({ field, label: FIELD_LABELS[field] ?? field, old: current[field], new: incoming[field] });
    }
  }
  return diffs;
}

function buildDescription(diffs: FieldDiff[]): string {
  return "Đã sửa: " + diffs.map((d) => d.label).join(", ");
}

// Snapshot NGAY TRUOC 1 lan sua noi dung — goi truoc prisma.<model>.update() trong route PATCH,
// KHONG goi o cac action chi doi status (submit/publish/schedule/unpublish) hay o productsSync.ts
// (LeadBase chi day gia/ton, khong phai noi dung admin tu sua). SO SANH current vs incoming truoc
// khi ghi (giong tinh than lich su don hang ben lead-base — changed_fields + description) — KHONG
// co field nao thuc su doi gia tri thi KHONG tao row Revision nao ca (tra ve null), tranh rac lich
// su voi cac lan bam "Luu" ma khong sua gi.
export async function saveRevision(
  entityType: RevisionEntityType,
  entityId: string,
  currentSnapshot: Record<string, unknown>,
  incomingPayload: Record<string, unknown>,
  userId: number | null,
) {
  const changedFields = diffFields(currentSnapshot, incomingPayload);
  if (changedFields.length === 0) {
    return null;
  }

  return prisma.revision.create({
    data: {
      entityType,
      entityId,
      data: currentSnapshot as Prisma.InputJsonValue,
      changedFields: changedFields as unknown as Prisma.InputJsonValue,
      description: buildDescription(changedFields),
      userId,
    },
  });
}

export function listRevisions(entityType: RevisionEntityType, entityId: string) {
  return prisma.revision.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });
}
