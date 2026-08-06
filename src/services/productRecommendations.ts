import { prisma } from "../db.js";

type RelatedConfig = { mode?: string; productIds?: string[]; categoryId?: string; limit?: number } | null | undefined;

const PRODUCT_SELECT = { id: true, slug: true, name: true, price: true, salePrice: true, imageUrls: true, excerpt: true };

type RecommendedProduct = {
  id: string;
  slug: string | null;
  name: string;
  price: unknown;
  salePrice: unknown;
  imageUrls: string[];
  excerpt: string | null;
};

async function fetchByConfig(config: RelatedConfig, excludeId: string, extraExcludeIds: string[] = []): Promise<RecommendedProduct[]> {
  if (!config) return [];
  const allExcludes = [excludeId, ...extraExcludeIds];
  if (config.mode === "specific" && Array.isArray(config.productIds) && config.productIds.length > 0) {
    return prisma.productCache.findMany({
      where: { id: { in: config.productIds }, status: "published" },
      select: PRODUCT_SELECT,
    });
  }
  if (config.mode === "category" && config.categoryId) {
    const limit = config.limit || 4;
    const inCategory = await prisma.productCache.findMany({
      where: { categories: { some: { id: config.categoryId } }, status: "published", id: { notIn: allExcludes } },
      select: { id: true },
    });
    if (inCategory.length === 0) return [];
    const shuffled = inCategory.sort(() => 0.5 - Math.random());
    const selectedIds = shuffled.slice(0, limit).map((x) => x.id);
    return prisma.productCache.findMany({ where: { id: { in: selectedIds } }, select: PRODUCT_SELECT });
  }
  return [];
}

export async function getCrossSellProducts(relatedProducts: unknown, excludeId: string): Promise<RecommendedProduct[]> {
  return fetchByConfig((relatedProducts as { crossSell?: RelatedConfig } | null)?.crossSell, excludeId);
}

const MAX_UPSELL = 4;

// "Co the ban quan tam" = san pham tu config upsell admin da chon (neu co) + san pham CUNG DANH
// MUC voi san pham hien tai (tu dong, khong can cau hinh gi them) - gop lai, loc trung theo id,
// toi da 8 san pham. Khac crossSell ("Mua kem uu dai") chi lay dung config admin da chon, khong
// tu dong bo sung gi ca.
export async function getUpsellProducts(
  product: { id: string; categories?: { id: string }[] },
  relatedProducts: unknown,
  excludeIds: string[] = []
): Promise<RecommendedProduct[]> {
  const configResults = await fetchByConfig((relatedProducts as { upsell?: RelatedConfig } | null)?.upsell, product.id, excludeIds);

  const categoryIds = (product.categories ?? []).map((c) => c.id);
  let sameCategoryResults: RecommendedProduct[] = [];
  if (categoryIds.length > 0) {
    const allExcludes = [product.id, ...excludeIds];
    const inCategory = await prisma.productCache.findMany({
      where: { categories: { some: { id: { in: categoryIds } } }, status: "published", id: { notIn: allExcludes } },
      select: { id: true },
    });
    if (inCategory.length > 0) {
      const shuffled = inCategory.sort(() => 0.5 - Math.random());
      const selectedIds = shuffled.slice(0, MAX_UPSELL).map((x) => x.id);
      sameCategoryResults = await prisma.productCache.findMany({
        where: { id: { in: selectedIds } },
        select: PRODUCT_SELECT,
      });
    }
  }

  const merged: RecommendedProduct[] = [];
  const seen = new Set<string>();
  for (const p of [...configResults, ...sameCategoryResults]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    merged.push(p);
    if (merged.length >= MAX_UPSELL) break;
  }
  return merged;
}
