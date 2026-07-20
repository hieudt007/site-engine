import { Role, ROLE_RANK } from "../plugins/requireRole.js";

// 4 trạng thái dùng chung cho Post/Page/ProductCache (schema.prisma, field "status"). Không dùng
// enum Prisma (Postgres enum khó ALTER thêm giá trị sau này) — giữ String như các field trạng
// thái khác trong schema (CartOrder.status, ProductReview.status...).
export const CONTENT_STATUSES = ["draft", "pending_review", "scheduled", "published"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

// Role TỐI THIỂU để 1 request được phép ĐẶT nội dung vào trạng thái này — không phải ma trận
// chuyển đổi đầy đủ, chỉ so "đích đến" (đơn giản hơn, đủ dùng): "edit" tự do giữa draft/
// pending_review (soạn/nộp duyệt), phải "manager" trở lên mới lên lịch/xuất bản được — giữ đúng
// luật cũ (trước đây chỉ có publishedAt, publish luôn cần requireRole("manager")).
const MIN_ROLE_FOR_STATUS: Record<ContentStatus, Role> = {
  draft: "edit",
  pending_review: "edit",
  scheduled: "manager",
  published: "manager",
};

export function canSetStatus(role: Role, status: ContentStatus): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE_FOR_STATUS[status]];
}

// "edit" chỉ sửa được nội dung khi còn draft/pending_review — 1 khi manager+ đã scheduled/
// published thì coi như đã "chốt", edit không tự ý sửa lại được nữa (mirror luật cũ: edit
// không sửa được bài đã publishedAt).
export function canEditContentFields(role: Role, status: string): boolean {
  if (role !== "edit") return true;
  return status === "draft" || status === "pending_review";
}
