import { XMLParser } from "fast-xml-parser";
import { prisma } from "../db.js";
import { slugify } from "./slug.js";
import { sanitizePostBody } from "./sanitizeHtml.js";
import { recomputeCategoryCounts } from "./categoryCounts.js";
import { uniqueProductSlug } from "./productSlug.js";

// Import noi dung tu file export WordPress (WXR - WordPress eXtended RSS, Tools > Export). Ho tro
// 3 post_type: "post" (bai viet -> Post.type='post'), "page" (trang tinh -> Post.type='page'),
// "product" (san pham WooCommerce -> ProductCache). Mot file WXR co the chua ca 3 loai lan nhau
// (export "All content") hoac chi 1 loai (export loc theo Posts/Pages/Products rieng) - ham nay
// tu loc dung tung loai co trong file, khong bat buoc file phai co du ca 3.

interface WpPostMeta {
  "wp:meta_key"?: string;
  "wp:meta_value"?: string;
}

interface WpCategory {
  "#text"?: string;
  "@_domain"?: string;
  "@_nicename"?: string;
}

interface WpItem {
  title?: string;
  "content:encoded"?: string;
  "excerpt:encoded"?: string;
  "wp:post_id"?: string | number;
  "wp:post_parent"?: string | number;
  "wp:post_name"?: string;
  "wp:post_type"?: string;
  "wp:status"?: string;
  "wp:post_date_gmt"?: string;
  "wp:attachment_url"?: string;
  "wp:postmeta"?: WpPostMeta[];
  category?: WpCategory | WpCategory[];
}

interface TypeSummary {
  total: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface ImportSummary {
  posts: TypeSummary;
  pages: TypeSummary;
  products: TypeSummary;
  errors: { title: string; message: string }[];
}

function emptyTypeSummary(): TypeSummary {
  return { total: 0, created: 0, updated: 0, skipped: 0 };
}

// WordPress Gutenberg luu block marker dang comment HTML "<!-- wp:paragraph -->"/"<!-- /wp:list -->"
// xen giua noi dung that - khong phai the HTML hop le, phai loai bo truoc khi sanitize/luu, neu
// khong sanitizePostBody se giu nguyen dang text la trong bai (sanitize-html khong tu nhan dien
// day la "comment" vi no da nam trong CDATA dang plain text, khong con la HTML comment that).
function stripGutenbergComments(html: string): string {
  return html.replace(/<!--\s*\/?wp:[^>]*-->/g, "").trim();
}

// Mot so trang (page builder nhu Themify/UX Builder/WPBakery) luu layout dang shortcode
// "[row][col]...[/col][/row]" thay vi HTML that - khong the render dep, chi loai bo de khong hien
// nguyen van "[row]" ra ngoai giao dien; MAT layout truc quan cua trang do (chap nhan danh doi, vi
// khong biet plugin nao da dung de render lai dung), chi con lai phan text/HTML thuan con sot.
function stripShortcodes(html: string): string {
  return html.replace(/\[\/?[a-zA-Z][^\[\]]*\]/g, "").trim();
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Rieng cho ProductCache.description: theo docblock schema.prisma, khi layoutMode='standard' truong
// nay la PLAIN TEXT (render escape + newline_to_br), KHONG phai HTML - khac han Post.body (HTML da
// sanitize). Giu lai xuong dong o ranh gioi khoi (p/li/br/heading) truoc khi bo het the, de van doc
// duoc tam on thay vi dinh lien 1 khoi chu.
function htmlToPlainTextWithBreaks(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function deriveExcerpt(text: string, maxLen = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLen) return flat;
  return flat.slice(0, maxLen).trimEnd() + "…";
}

function metaValue(postmeta: WpPostMeta[] | undefined, key: string): string | undefined {
  return postmeta?.find((m) => m["wp:meta_key"] === key)?.["wp:meta_value"];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// Fastify (find-my-way) mac dinh gioi han do dai 1 route param la 100 ky tu - tieu de bai viet
// WordPress dai (vd tieu de SEO du) tao ra wp:post_name/slugify(title) co the vuot qua, gay loi
// that FST_ERR_MAX_PARAM_LENGTH (414) khi khach vao xem bai (loi da gap that). Cat bot con 80 ky
// tu (chua tinh hau to "-2"/"-3" neu trung sau nay o uniqueProductSlug), cat dung ranh gioi dau "-"
// gan nhat de khong cat dut giua tu.
const MAX_SLUG_LENGTH = 80;
function capSlugLength(slug: string): string {
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  const lastDash = cut.lastIndexOf("-");
  const trimmed = lastDash > 40 ? cut.slice(0, lastDash) : cut;
  return trimmed.replace(/-+$/, "") || cut;
}

// Cac slug trang mac dinh WordPress/WooCommerce tu sinh (Gio hang/Thanh toan/Tai khoan/Trang
// chu/Shop/Blog...) - CHI la placeholder tro toi template dac biet cua WooCommerce/WP, khong phai
// noi dung thuc, va trung ten voi cac chuc nang co san (/cart, /checkout, /account...) cua site
// nay - import se tao trang rac/trung lap nen chu dong bo qua.
const SYSTEM_PAGE_SLUGS = new Set([
  "cart", "checkout", "my-account", "shop", "home",
  "gio-hang", "thanh-toan", "tai-khoan", "san-pham", "trang-chu", "blog",
]);

export async function importWordpressXml(xml: string, authorId: number | null): Promise<ImportSummary> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: false,
    isArray: (name) => ["item", "category", "wp:postmeta"].includes(name),
  });

  const doc = parser.parse(xml);
  const items: WpItem[] = asArray(doc?.rss?.channel?.item);

  // Anh dinh kem (post_type="attachment") - dung wp:post_id lam khoa tra ve URL that, de map
  // _thumbnail_id (postmeta cua bai viet/trang/san pham) -> anh dai dien. Giu nguyen URL goc tren
  // server WordPress cu (KHONG tai ve luu lai vao uploads/ - don gian hoa co chu dich, chi can hien
  // duoc anh; neu WordPress cu ngung host anh thi anh se hien loi, luc do moi can tinh nang tai anh
  // ve rieng).
  const attachmentUrlById = new Map<string, string>();
  for (const item of items) {
    if (item["wp:post_type"] === "attachment" && item["wp:post_id"] != null) {
      const url = item["wp:attachment_url"];
      if (url) attachmentUrlById.set(String(item["wp:post_id"]), url);
    }
  }

  const summary: ImportSummary = { posts: emptyTypeSummary(), pages: emptyTypeSummary(), products: emptyTypeSummary(), errors: [] };
  const touchedCategoryIds = new Set<string>();

  const seoOf = (item: WpItem) => {
    const metaDescription = metaValue(item["wp:postmeta"], "rank_math_description");
    const keyword = metaValue(item["wp:postmeta"], "rank_math_focus_keyword");
    return metaDescription || keyword ? { metaDescription: metaDescription || undefined, keyword: keyword || undefined } : undefined;
  };

  // ---- Bai viet (type='post') ----
  const postItems = items.filter((item) => item["wp:post_type"] === "post");
  summary.posts.total = postItems.length;

  for (const item of postItems) {
    const title = (item.title ?? "").trim();
    try {
      if (!title) {
        summary.posts.skipped++;
        continue;
      }

      const slug = capSlugLength((item["wp:post_name"] || slugify(title)).trim() || slugify(title));
      const rawBody = stripGutenbergComments(item["content:encoded"] ?? "");
      const body = sanitizePostBody(rawBody);
      if (!body) {
        summary.posts.skipped++;
        summary.errors.push({ title, message: "Nội dung rỗng sau khi làm sạch, đã bỏ qua." });
        continue;
      }

      const rawExcerpt = stripGutenbergComments(item["excerpt:encoded"] ?? "");
      const excerpt = rawExcerpt ? stripHtmlToText(rawExcerpt) : deriveExcerpt(stripHtmlToText(body));

      const thumbnailId = metaValue(item["wp:postmeta"], "_thumbnail_id");
      const coverImage = thumbnailId ? attachmentUrlById.get(thumbnailId) : undefined;

      const status = item["wp:status"] === "publish" ? "published" : "draft";
      const publishedAt = status === "published" && item["wp:post_date_gmt"] ? new Date(item["wp:post_date_gmt"] + "Z") : null;

      const categoryNames = asArray(item.category)
        .filter((c) => c["@_domain"] === "category" && c["#text"])
        .map((c) => ({ name: c["#text"] as string, slug: c["@_nicename"] || slugify(c["#text"] as string) }));

      const categoryIds: string[] = [];
      for (const cat of categoryNames) {
        const category = await prisma.category.upsert({
          where: { type_slug: { type: "post", slug: cat.slug } },
          update: {},
          create: { type: "post", name: cat.name, slug: cat.slug },
        });
        categoryIds.push(category.id);
        touchedCategoryIds.add(category.id);
      }

      const existing = await prisma.post.findUnique({ where: { type_slug: { type: "post", slug } } });
      const base = {
        title,
        body,
        excerpt: excerpt || undefined,
        coverImage: coverImage || undefined,
        status,
        publishedAt,
        authorId: authorId ?? undefined,
        seo: seoOf(item),
      };

      if (existing) {
        // "set" thay the TOAN BO quan he nhieu-nhieu bang danh sach moi - dung cho update (khac
        // create ben duoi, "set" khong hop le luc tao moi vi chua co ban ghi de thay the).
        await prisma.post.update({ where: { id: existing.id }, data: { ...base, categories: { set: categoryIds.map((id) => ({ id })) } } });
        summary.posts.updated++;
      } else {
        await prisma.post.create({ data: { type: "post", slug, ...base, categories: { connect: categoryIds.map((id) => ({ id })) } } });
        summary.posts.created++;
      }
    } catch (err) {
      summary.errors.push({ title: title || "(không có tiêu đề)", message: (err as Error).message });
    }
  }

  // ---- Trang tinh (type='page') ----
  const pageItems = items.filter((item) => item["wp:post_type"] === "page");
  summary.pages.total = pageItems.length;

  for (const item of pageItems) {
    const title = (item.title ?? "").trim();
    try {
      if (!title) {
        summary.pages.skipped++;
        continue;
      }

      const rawSlug = (item["wp:post_name"] || slugify(title)).trim() || slugify(title);
      if (SYSTEM_PAGE_SLUGS.has(rawSlug)) {
        summary.pages.skipped++;
        summary.errors.push({ title, message: `Trang mặc định của WordPress/WooCommerce ("${rawSlug}"), không phải nội dung thực, đã bỏ qua.` });
        continue;
      }
      const slug = capSlugLength(rawSlug);

      const cleaned = stripShortcodes(stripGutenbergComments(item["content:encoded"] ?? ""));
      const body = sanitizePostBody(cleaned);
      if (!body) {
        summary.pages.skipped++;
        summary.errors.push({ title, message: "Nội dung rỗng hoặc chỉ chứa shortcode page-builder không thể chuyển đổi tự động, đã bỏ qua." });
        continue;
      }

      const rawExcerpt = stripGutenbergComments(item["excerpt:encoded"] ?? "");
      const excerpt = rawExcerpt ? stripHtmlToText(rawExcerpt) : deriveExcerpt(stripHtmlToText(body));
      const thumbnailId = metaValue(item["wp:postmeta"], "_thumbnail_id");
      const coverImage = thumbnailId ? attachmentUrlById.get(thumbnailId) : undefined;
      const status = item["wp:status"] === "publish" ? "published" : "draft";
      const publishedAt = status === "published" && item["wp:post_date_gmt"] ? new Date(item["wp:post_date_gmt"] + "Z") : null;

      const existing = await prisma.post.findUnique({ where: { type_slug: { type: "page", slug } } });
      const base = {
        title,
        body,
        excerpt: excerpt || undefined,
        coverImage: coverImage || undefined,
        status,
        publishedAt,
        authorId: authorId ?? undefined,
        seo: seoOf(item),
      };

      if (existing) {
        await prisma.post.update({ where: { id: existing.id }, data: base });
        summary.pages.updated++;
      } else {
        await prisma.post.create({ data: { type: "page", slug, ...base } });
        summary.pages.created++;
      }
    } catch (err) {
      summary.errors.push({ title: title || "(không có tiêu đề)", message: (err as Error).message });
    }
  }

  // ---- San pham (post_type='product', WooCommerce) ----
  const productItems = items.filter((item) => item["wp:post_type"] === "product");
  summary.products.total = productItems.length;

  for (const item of productItems) {
    const title = (item.title ?? "").trim();
    try {
      if (!title) {
        summary.products.skipped++;
        continue;
      }

      const wpPostId = item["wp:post_id"] != null ? String(item["wp:post_id"]) : undefined;
      if (!wpPostId) {
        summary.products.skipped++;
        summary.errors.push({ title, message: "Thiếu wp:post_id, không xác định được sản phẩm." });
        continue;
      }

      // leadbaseProductId that su chi ton tai cho san pham dong bo tu LeadBase - san pham import tu
      // WordPress KHONG co nguon do, phai tu sinh 1 gia tri on dinh+duy nhat de thoa unique
      // constraint. Tien to "wp-" tranh dung dang voi id LeadBase that (so thuan), an toan khong
      // trung. On dinh giua cac lan import lai (dua tren wp:post_id, khong doi) nen chay lai import
      // se UPDATE dung ban ghi cu, khong tao trung.
      const leadbaseProductId = `wp-${wpPostId}`;
      const existingProduct = await prisma.productCache.findUnique({ where: { leadbaseProductId } });
      const desiredSlug = capSlugLength((item["wp:post_name"] || slugify(title)).trim() || slugify(title));
      const slug = await uniqueProductSlug(desiredSlug, existingProduct?.id);
      const postmeta = item["wp:postmeta"];

      // ProductCache.description CHI la plain text khi layoutMode='standard' (mac dinh, giu du UI
      // mua hang/gia/variant cua product-detail.liquid) - KHONG duoc luu HTML tho vao day, neu
      // khong se bi escape hien nguyen the <p> ra man hinh. Doi lai layoutMode='custom' se lam mat
      // toan bo UI mua hang (chi con dump mo ta), khong phu hop cho san pham that.
      const rawDescription = stripShortcodes(stripGutenbergComments(item["content:encoded"] ?? ""));
      const description = htmlToPlainTextWithBreaks(rawDescription);
      const rawExcerpt = stripShortcodes(stripGutenbergComments(item["excerpt:encoded"] ?? ""));
      const excerpt = rawExcerpt ? deriveExcerpt(stripHtmlToText(rawExcerpt)) : deriveExcerpt(description);

      const price = toNumber(metaValue(postmeta, "_regular_price")) ?? toNumber(metaValue(postmeta, "_price")) ?? 0;
      const rawSalePrice = toNumber(metaValue(postmeta, "_sale_price"));
      const salePrice = rawSalePrice != null && rawSalePrice < price ? rawSalePrice : null;

      const manageStock = metaValue(postmeta, "_manage_stock") === "yes";
      const stockStatus = metaValue(postmeta, "_stock_status");
      const stock = manageStock ? toNumber(metaValue(postmeta, "_stock")) ?? 0 : stockStatus === "outofstock" ? 0 : null;

      const thumbnailId = metaValue(postmeta, "_thumbnail_id");
      const galleryIds = (metaValue(postmeta, "_product_image_gallery") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const imageUrls = [...(thumbnailId ? [thumbnailId] : []), ...galleryIds]
        .map((id) => attachmentUrlById.get(id))
        .filter((url): url is string => !!url);

      const status = item["wp:status"] === "publish" ? "published" : "draft";
      const publishedAt = status === "published" && item["wp:post_date_gmt"] ? new Date(item["wp:post_date_gmt"] + "Z") : null;

      const categoryNames = asArray(item.category)
        .filter((c) => c["@_domain"] === "product_cat" && c["#text"])
        .map((c) => ({ name: c["#text"] as string, slug: c["@_nicename"] || slugify(c["#text"] as string) }));

      const categoryIds: string[] = [];
      for (const cat of categoryNames) {
        const category = await prisma.category.upsert({
          where: { type_slug: { type: "product", slug: cat.slug } },
          update: {},
          create: { type: "product", name: cat.name, slug: cat.slug },
        });
        categoryIds.push(category.id);
        touchedCategoryIds.add(category.id);
      }

      const existing = existingProduct;

      const base = {
        name: title,
        slug,
        description: description || undefined,
        excerpt: excerpt || undefined,
        imageUrls,
        price,
        salePrice,
        stock,
        status,
        publishedAt,
        seo: seoOf(item),
      };

      if (existing) {
        await prisma.productCache.update({
          where: { id: existing.id },
          data: { ...base, categories: { set: categoryIds.map((id) => ({ id })) } },
        });
        summary.products.updated++;
      } else {
        await prisma.productCache.create({
          data: {
            ...base,
            leadbaseProductId,
            leadbaseStatus: "imported",
            categories: { connect: categoryIds.map((id) => ({ id })) },
          },
        });
        summary.products.created++;
      }
    } catch (err) {
      summary.errors.push({ title: title || "(không có tiêu đề)", message: (err as Error).message });
    }
  }

  if (touchedCategoryIds.size > 0) {
    await recomputeCategoryCounts([...touchedCategoryIds]);
  }

  return summary;
}
