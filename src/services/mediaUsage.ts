import { prisma } from "../db.js";
import { CacheService } from "./CacheService.js";

// Cac noi trong DB co the chua 1 URL anh (Media.url) o dang chuoi tho (KHONG phai foreign key -
// xem ghi chu trong Media.url + mediaStorage.ts) - dung chung cho ca "kiem tra dang dung o dau"
// (truoc khi cho xoa) va "doi URL cu -> moi" (luc migrate sang R2). Cac truong nay CO THE chua
// anh ngoai (khong phai tu Media Library) nen luc doi chi thay dung URL khop tuyet doi, khong
// dong tro thanh he thong quan ly bang foreign key (xem giai thich day du da trao doi voi user).
type MediaUsage = { model: string; id: string; label: string };

async function findUsages(url: string): Promise<MediaUsage[]> {
  const [posts, categories, products, reviews, siteConfig] = await Promise.all([
    prisma.post.findMany({
      where: { OR: [{ coverImage: url }, { body: { contains: url } }, { seo: { path: ["ogImage"], equals: url } }] },
      select: { id: true, title: true, type: true },
    }),
    prisma.category.findMany({
      where: { OR: [{ body: { contains: url } }, { seo: { path: ["ogImage"], equals: url } }] },
      select: { id: true, name: true },
    }),
    prisma.productCache.findMany({
      where: { OR: [{ imageUrls: { has: url } }, { description: { contains: url } }, { seo: { path: ["ogImage"], equals: url } }] },
      select: { id: true, name: true },
    }),
    prisma.productReview.findMany({ where: { imageUrls: { has: url } }, select: { id: true, customerName: true } }),
    prisma.siteConfig.findUnique({ where: { id: "singleton" } }),
  ]);

  const usages: MediaUsage[] = [
    ...posts.map((p) => ({ model: p.type === "page" ? "Trang tĩnh" : "Bài viết", id: p.id, label: p.title })),
    ...categories.map((c) => ({ model: "Danh mục", id: c.id, label: c.name })),
    ...products.map((p) => ({ model: "Sản phẩm", id: p.id, label: p.name })),
    ...reviews.map((r) => ({ model: "Đánh giá sản phẩm", id: r.id, label: r.customerName })),
  ];

  if (siteConfig) {
    if (siteConfig.logoUrl === url) usages.push({ model: "Cài đặt", id: "singleton", label: "Logo website" });
    if (siteConfig.faviconUrl === url) usages.push({ model: "Cài đặt", id: "singleton", label: "Favicon" });
    if (siteConfig.defaultOgImage === url) usages.push({ model: "Cài đặt", id: "singleton", label: "Ảnh OG mặc định" });
  }

  return usages;
}

/** Dung truoc khi cho xoa 1 Media - tra ve danh sach noi dang dung de bao loi ro rang cho admin. */
export async function findMediaUsage(url: string): Promise<MediaUsage[]> {
  return findUsages(url);
}

/**
 * Doi tat ca cho dang tham chieu oldUrl (chuoi tho) sang newUrl - dung khi migrate 1 Media sang
 * R2 (xem migrateLocalMediaToR2 trong mediaStorage.ts) de khong lam gay anh dang hien thi tren
 * site. Chi thay khop TUYET DOI voi oldUrl, khong dong toi cac URL anh ngoai khac.
 */
export async function rewriteMediaUrlReferences(oldUrl: string, newUrl: string): Promise<void> {
  const [posts, categories, products, reviews] = await Promise.all([
    prisma.post.findMany({
      where: { OR: [{ coverImage: oldUrl }, { body: { contains: oldUrl } }, { seo: { path: ["ogImage"], equals: oldUrl } }] },
    }),
    prisma.category.findMany({
      where: { OR: [{ body: { contains: oldUrl } }, { seo: { path: ["ogImage"], equals: oldUrl } }] },
    }),
    prisma.productCache.findMany({
      where: { OR: [{ imageUrls: { has: oldUrl } }, { description: { contains: oldUrl } }, { seo: { path: ["ogImage"], equals: oldUrl } }] },
    }),
    prisma.productReview.findMany({ where: { imageUrls: { has: oldUrl } } }),
  ]);

  for (const post of posts) {
    const seo = post.seo as { ogImage?: string } | null;
    await prisma.post.update({
      where: { id: post.id },
      data: {
        coverImage: post.coverImage === oldUrl ? newUrl : post.coverImage,
        body: post.body.split(oldUrl).join(newUrl),
        ...(seo?.ogImage === oldUrl ? { seo: { ...seo, ogImage: newUrl } } : {}),
      },
    });
  }

  for (const category of categories) {
    const seo = category.seo as { ogImage?: string } | null;
    await prisma.category.update({
      where: { id: category.id },
      data: {
        ...(category.body ? { body: category.body.split(oldUrl).join(newUrl) } : {}),
        ...(seo?.ogImage === oldUrl ? { seo: { ...seo, ogImage: newUrl } } : {}),
      },
    });
  }

  for (const product of products) {
    const seo = product.seo as { ogImage?: string } | null;
    await prisma.productCache.update({
      where: { id: product.id },
      data: {
        imageUrls: product.imageUrls.map((u) => (u === oldUrl ? newUrl : u)),
        ...(product.description ? { description: product.description.split(oldUrl).join(newUrl) } : {}),
        ...(seo?.ogImage === oldUrl ? { seo: { ...seo, ogImage: newUrl } } : {}),
      },
    });
  }

  for (const review of reviews) {
    await prisma.productReview.update({
      where: { id: review.id },
      data: { imageUrls: review.imageUrls.map((u) => (u === oldUrl ? newUrl : u)) },
    });
  }

  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  if (siteConfig) {
    const data: Record<string, string> = {};
    if (siteConfig.logoUrl === oldUrl) data.logoUrl = newUrl;
    if (siteConfig.faviconUrl === oldUrl) data.faviconUrl = newUrl;
    if (siteConfig.defaultOgImage === oldUrl) data.defaultOgImage = newUrl;
    if (Object.keys(data).length > 0) {
      await prisma.siteConfig.update({ where: { id: "singleton" }, data });
      // BUG that: gia tri DB da doi dung nhung CacheService.getSiteConfig() cache 24h (xem
      // DEFAULT_TTL) - khong xoa cache thi site van hien logo/favicon/OG cu (URL local da mat)
      // toi khi cache tu het han. Phai xoa NGAY sau khi ghi de site thay doi tuc thi.
      await CacheService.forget("global:site_config");
    }
  }
}
