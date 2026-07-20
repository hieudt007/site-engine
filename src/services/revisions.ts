import { prisma } from "../db.js";

export type RevisionEntityType = "Post" | "Page" | "Product";

// Snapshot NGAY TRƯỚC 1 lần sửa nội dung — gọi trước prisma.<model>.update() trong route PATCH,
// KHÔNG gọi ở các action chỉ đổi status (submit/publish/schedule/unpublish) hay ở productsSync.ts
// (LeadBase chỉ đẩy giá/tồn, không phải nội dung admin tự sửa).
export function saveRevision(
  entityType: RevisionEntityType,
  entityId: string,
  data: object,
  userId: number | null,
) {
  return prisma.revision.create({ data: { entityType, entityId, data, userId } });
}

export function listRevisions(entityType: RevisionEntityType, entityId: string) {
  return prisma.revision.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });
}
