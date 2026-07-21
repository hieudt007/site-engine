import { prisma } from "../db.js";
import type { Coupon } from "@prisma/client";

export interface CouponValidationResult {
  ok: boolean;
  error?: string;
  discountAmount?: number;
  coupon?: Coupon;
}

// Goi luc checkout (truoc khi tao CartOrder) - KHONG tang usedCount o day, chi validate + tinh so
// tien giam. incrementCouponUsage() goi rieng SAU KHI da tao don thanh cong (xem cart.ts).
export async function validateCoupon(code: string, subtotal: number): Promise<CouponValidationResult> {
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.enabled) {
    return { ok: false, error: "Mã giảm giá không tồn tại hoặc đã bị tắt" };
  }
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Mã giảm giá đã hết hạn" };
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    return { ok: false, error: "Mã giảm giá đã hết lượt sử dụng" };
  }
  if (subtotal < coupon.minOrderTotal) {
    return { ok: false, error: `Đơn hàng tối thiểu ${coupon.minOrderTotal}₫ để áp dụng mã này` };
  }

  const rawDiscount =
    coupon.discountType === "percent" ? Math.round((subtotal * coupon.discountValue) / 100) : coupon.discountValue;

  return { ok: true, discountAmount: Math.min(rawDiscount, subtotal), coupon };
}

export async function incrementCouponUsage(code: string): Promise<void> {
  await prisma.coupon.update({ where: { code }, data: { usedCount: { increment: 1 } } });
}
