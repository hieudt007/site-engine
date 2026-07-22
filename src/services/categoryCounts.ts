import { prisma } from "../db.js";

export async function recomputeCategoryCount(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, type: true } });
  if (!category) return;

  let itemCount = 0;
  if (category.type === "post") {
    itemCount = await prisma.post.count({
      where: { type: "post", categories: { some: { id: category.id } } },
    });
  } else if (category.type === "product") {
    itemCount = await prisma.productCache.count({
      where: { categories: { some: { id: category.id } } },
    });
  } else if (category.type === "brand") {
    itemCount = await prisma.productCache.count({
      where: { brandId: category.id },
    });
  }

  await prisma.category.update({ where: { id: category.id }, data: { itemCount } });
}

export async function recomputeCategoryCounts(categoryIds: Array<string | null | undefined>): Promise<void> {
  const uniqueIds = [...new Set(categoryIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  await Promise.all(uniqueIds.map((id) => recomputeCategoryCount(id)));
}

export async function recomputeAllCategoryCounts(): Promise<void> {
  const categories = await prisma.category.findMany({ select: { id: true } });
  await recomputeCategoryCounts(categories.map((category) => category.id));
}
