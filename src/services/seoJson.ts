// Đọc field "seo" (Prisma Json, không có type tĩnh) của Post/Page/ProductCache. An toàn vì hình
// dạng đã được validate lúc GHI (zod seoSchema trong routes/admin/{posts,pages,products}.ts) —
// ở đây chỉ cast lại, không cần validate runtime lần nữa.
export interface SeoFields {
  metaTitle?: string;
  metaDescription?: string;
  ogImage?: string;
  noindex?: boolean;
  keyword?: string;
  score?: number;
  checks?: SeoCheck[];
  analyzedAt?: string;
}

export interface SeoCheck {
  key: string;
  status: "pass" | "warning" | "fail";
  message: string;
  points: number;
  maxPoints: number;
}

export function readSeo(value: unknown): SeoFields {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as SeoFields;
  }
  return {};
}
