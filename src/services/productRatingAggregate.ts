import { prisma } from "../db.js";

// Denormalize reviewCount/avgRating tu ProductReview (chi tinh status='approved') vao chinh
// ProductCache - tranh phai JOIN/aggregate lai moi lan hien trang danh sach/danh muc san pham (N+1
// neu tinh rieng tung san pham trong 1 danh sach). Goi lai moi khi 1 review duyet/tu choi
// (routes/admin/reviews.ts) - KHONG goi luc tao review (luon tao o "pending", chua anh huong).
export async function recomputeProductRatingAggregate(productCacheId: string): Promise<void> {
  const approved = await prisma.productReview.findMany({
    where: { productCacheId, status: "approved" },
    select: { rating: true },
  });

  const reviewCount = approved.length;
  const avgRating = reviewCount
    ? Math.round((approved.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
    : null;

  await prisma.productCache.update({
    where: { id: productCacheId },
    data: { reviewCount, avgRating },
  });
}
