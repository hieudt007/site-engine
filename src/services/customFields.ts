import { z } from "zod";

// Trường tùy biến do ADMIN TỰ ĐẶT TAY (map string->string đơn giản, không nested) — cho
// Post/Page/Product/Category/Topic/ProductReview. KHÔNG dùng cho số liệu hệ thống tự tính (vd
// lượt xem — cần atomic increment, đi thẳng vào 1 cột riêng, không qua đây, xem trao đổi lúc
// thiết kế). Cùng convention với services/seoJson.ts: validate lúc GHI (schema dưới), lúc ĐỌC chỉ
// cast lại.
export const customFieldsSchema = z.record(z.string(), z.string()).optional();

export type CustomFields = Record<string, string>;

export function readCustomFields(value: unknown): CustomFields {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as CustomFields;
  }
  return {};
}

export function getCustomField(value: unknown, key: string): string | undefined {
  return readCustomFields(value)[key];
}
