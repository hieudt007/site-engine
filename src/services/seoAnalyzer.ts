import { readSeo, SeoCheck, SeoFields } from "./seoJson.js";

type ContentTarget = {
  title: string;
  slug: string | null | undefined;
  body: string | null | undefined;
  excerpt?: string | null;
  coverImage?: string | null;
  seo?: unknown;
  faq?: unknown;
};

type ProductTarget = {
  name: string;
  slug: string | null | undefined;
  description: string | null | undefined;
  excerpt?: string | null;
  imageUrls?: string[];
  seo?: unknown;
  faq?: unknown;
  specs?: unknown;
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function stripHtml(value: string | null | undefined): string {
  return normalize(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string): number {
  return value ? value.split(/\s+/).filter(Boolean).length : 0;
}

function includesKeyword(value: string | null | undefined, keyword: string): boolean {
  if (!keyword) return false;
  const keywords = keyword.split(",").map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0) return false;
  const normalizedValue = normalize(value).toLocaleLowerCase("vi-VN");
  return keywords.some((k) => normalizedValue.includes(k.toLocaleLowerCase("vi-VN")));
}

function countMatches(value: string | null | undefined, pattern: RegExp): number {
  return normalize(value).match(pattern)?.length ?? 0;
}

function hasFaq(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasStructuredList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function keepSeoFields(seo: SeoFields): SeoFields {
  const result: SeoFields = {};
  if (seo.metaTitle) result.metaTitle = seo.metaTitle;
  if (seo.metaDescription) result.metaDescription = seo.metaDescription;
  if (seo.ogImage) result.ogImage = seo.ogImage;
  if (seo.keyword) result.keyword = seo.keyword;
  if (seo.noindex) result.noindex = true;
  return result;
}

function check(key: string, ok: boolean, warn: boolean, maxPoints: number, passMessage: string, warningMessage: string, failMessage: string): SeoCheck {
  const status = ok ? "pass" : warn ? "warning" : "fail";
  return {
    key,
    status,
    message: status === "pass" ? passMessage : status === "warning" ? warningMessage : failMessage,
    points: status === "pass" ? maxPoints : status === "warning" ? Math.round(maxPoints * 0.5) : 0,
    maxPoints,
  };
}

function scoreFromChecks(checks: SeoCheck[]): number {
  const max = checks.reduce((sum, item) => sum + item.maxPoints, 0);
  if (!max) return 0;
  return Math.round((checks.reduce((sum, item) => sum + item.points, 0) / max) * 100);
}

function finish(seo: SeoFields, checks: SeoCheck[]): SeoFields {
  return {
    ...keepSeoFields(seo),
    score: scoreFromChecks(checks),
    checks,
    analyzedAt: new Date().toISOString(),
  };
}

export function analyzeContentSeo(target: ContentTarget): SeoFields {
  const seo = readSeo(target.seo);
  const title = normalize(target.title);
  const slug = normalize(target.slug);
  const metaTitle = normalize(seo.metaTitle) || title;
  const metaDescription = normalize(seo.metaDescription) || normalize(target.excerpt);
  const keyword = normalize(seo.keyword);
  const text = stripHtml(target.body);
  const contentWords = wordCount(text);
  const h2Count = countMatches(target.body, /<h2[\s>]/gi);
  const h3Count = countMatches(target.body, /<h3[\s>]/gi);
  const imageCount = countMatches(target.body, /<img[\s>]/gi);
  const imageWithAltCount = countMatches(target.body, /<img\b(?=[^>]*\balt=["'][^"']+["'])[^>]*>/gi);
  const internalLinkCount = countMatches(target.body, /<a\b(?=[^>]*\bhref=["']\/[^"']*["'])[^>]*>/gi);

  const checks: SeoCheck[] = [
    check("keyword", !!keyword, false, 10, "Có từ khoá chính.", "Có từ khoá chính.", "Nên nhập từ khoá chính để hệ thống chấm SEO sát hơn."),
    check("meta_title", metaTitle.length >= 35 && metaTitle.length <= 60, metaTitle.length > 0, 12, "Meta title có độ dài tốt.", "Meta title nên dài khoảng 35-60 ký tự.", "Thiếu meta title."),
    check("meta_description", metaDescription.length >= 120 && metaDescription.length <= 160, metaDescription.length > 0, 12, "Meta description có độ dài tốt.", "Meta description nên dài khoảng 120-160 ký tự.", "Thiếu meta description."),
    check("keyword_in_title", includesKeyword(metaTitle || title, keyword), !keyword, 8, "Từ khoá xuất hiện trong tiêu đề.", "Chưa thể kiểm tra vì thiếu từ khoá.", "Nên đưa từ khoá chính vào title hoặc meta title."),
    check("keyword_in_description", includesKeyword(metaDescription, keyword), !keyword, 8, "Từ khoá xuất hiện trong meta description.", "Chưa thể kiểm tra vì thiếu từ khoá.", "Nên đưa từ khoá chính vào meta description."),
    check("keyword_in_slug", includesKeyword(slug.replace(/-/g, " "), keyword), !keyword, 6, "Slug có liên quan từ khoá.", "Chưa thể kiểm tra vì thiếu từ khoá.", "Slug nên chứa từ khoá chính hoặc biến thể ngắn."),
    check("excerpt", normalize(target.excerpt).length >= 60, normalize(target.excerpt).length > 0, 8, "Có mô tả ngắn tốt.", "Mô tả ngắn hơi ngắn.", "Nên có mô tả ngắn/excerpt."),
    check("content_length", contentWords >= 500, contentWords >= 250, 12, "Nội dung đủ dài.", "Nội dung hơi ngắn.", "Nội dung quá ngắn cho SEO."),
    check("headings", h2Count + h3Count >= 2, h2Count + h3Count >= 1, 8, "Có cấu trúc heading tốt.", "Nên thêm H2/H3 để chia ý rõ hơn.", "Thiếu heading H2/H3."),
    check("cover_image", !!normalize(target.coverImage || seo.ogImage), false, 6, "Có ảnh đại diện/chia sẻ.", "Có ảnh đại diện/chia sẻ.", "Nên thêm ảnh đại diện hoặc ảnh Open Graph."),
    check("image_alt", imageCount === 0 || imageWithAltCount === imageCount, imageWithAltCount > 0, 5, "Ảnh trong nội dung có alt.", "Một số ảnh thiếu alt.", "Ảnh trong nội dung nên có alt."),
    check("internal_links", internalLinkCount > 0, false, 5, "Có liên kết nội bộ.", "Có liên kết nội bộ.", "Nên thêm ít nhất một liên kết nội bộ."),
    check("faq", hasFaq(target.faq), false, 3, "Có FAQ hỗ trợ nội dung.", "Có FAQ hỗ trợ nội dung.", "Có thể thêm FAQ nếu phù hợp."),
    check("indexable", !seo.noindex, false, 2, "Trang cho phép index.", "Trang cho phép index.", "Trang đang bật noindex."),
  ];

  return finish(seo, checks);
}

export function analyzeProductSeo(target: ProductTarget): SeoFields {
  const seo = readSeo(target.seo);
  const name = normalize(target.name);
  const slug = normalize(target.slug);
  const metaTitle = normalize(seo.metaTitle) || name;
  const metaDescription = normalize(seo.metaDescription) || normalize(target.excerpt);
  const keyword = normalize(seo.keyword);
  const text = stripHtml(target.description);
  const contentWords = wordCount(text);
  const imageCount = target.imageUrls?.filter(Boolean).length ?? 0;

  const checks: SeoCheck[] = [
    check("keyword", !!keyword, false, 10, "Có từ khoá chính.", "Có từ khoá chính.", "Nên nhập từ khoá chính cho sản phẩm."),
    check("meta_title", metaTitle.length >= 35 && metaTitle.length <= 60, metaTitle.length > 0, 12, "Meta title có độ dài tốt.", "Meta title nên dài khoảng 35-60 ký tự.", "Thiếu meta title."),
    check("meta_description", metaDescription.length >= 120 && metaDescription.length <= 160, metaDescription.length > 0, 12, "Meta description có độ dài tốt.", "Meta description nên dài khoảng 120-160 ký tự.", "Thiếu meta description."),
    check("keyword_in_name", includesKeyword(metaTitle || name, keyword), !keyword, 8, "Từ khoá xuất hiện trong tên/title.", "Chưa thể kiểm tra vì thiếu từ khoá.", "Nên đưa từ khoá chính vào tên hoặc meta title."),
    check("keyword_in_description", includesKeyword(metaDescription, keyword), !keyword, 8, "Từ khoá xuất hiện trong meta description.", "Chưa thể kiểm tra vì thiếu từ khoá.", "Nên đưa từ khoá chính vào meta description."),
    check("keyword_in_slug", includesKeyword(slug.replace(/-/g, " "), keyword), !keyword, 6, "Slug có liên quan từ khoá.", "Chưa thể kiểm tra vì thiếu từ khoá.", "Slug nên chứa từ khoá chính hoặc biến thể ngắn."),
    check("excerpt", normalize(target.excerpt).length >= 50, normalize(target.excerpt).length > 0, 8, "Có mô tả ngắn tốt.", "Mô tả ngắn hơi ngắn.", "Nên có mô tả ngắn cho sản phẩm."),
    check("description_length", contentWords >= 180, contentWords >= 80, 12, "Mô tả sản phẩm đủ thông tin.", "Mô tả sản phẩm hơi ngắn.", "Mô tả sản phẩm quá ngắn."),
    check("images", imageCount >= 2, imageCount >= 1, 10, "Có nhiều ảnh sản phẩm.", "Nên thêm ít nhất 2 ảnh sản phẩm.", "Thiếu ảnh sản phẩm."),
    check("specs", hasStructuredList(target.specs), false, 5, "Có thông số sản phẩm.", "Có thông số sản phẩm.", "Nên thêm thông số sản phẩm nếu phù hợp."),
    check("faq", hasFaq(target.faq), false, 4, "Có FAQ hỗ trợ bán hàng.", "Có FAQ hỗ trợ bán hàng.", "Có thể thêm FAQ nếu phù hợp."),
    check("og_image", !!normalize(seo.ogImage) || imageCount > 0, false, 3, "Có ảnh chia sẻ.", "Có ảnh chia sẻ.", "Nên có ảnh chia sẻ/Open Graph."),
    check("indexable", !seo.noindex, false, 2, "Sản phẩm cho phép index.", "Sản phẩm cho phép index.", "Sản phẩm đang bật noindex."),
  ];

  return finish(seo, checks);
}
