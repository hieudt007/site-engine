import { prisma } from "../db.js";
import { slugify } from "./slug.js";

export async function uniqueProductSlug(name: string, currentProductId?: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.productCache.findUnique({ where: { slug: candidate } as any });
    if (!existing || existing.id === currentProductId) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function ensureProductSlug<T extends { id: string; name: string; slug?: string | null }>(product: T): Promise<T> {
  if (product.slug) {
    return product;
  }
  const slug = await uniqueProductSlug(product.name, product.id);
  await prisma.productCache.update({ where: { id: product.id }, data: { slug } as any });
  product.slug = slug;
  return product;
}

export async function ensureProductSlugs<T extends { id: string; name: string; slug?: string | null }>(products: T[]): Promise<T[]> {
  await Promise.all(products.map((product) => ensureProductSlug(product)));
  return products;
}
