import { prisma } from "../db.js";
import type { ShippingRule } from "@prisma/client";

// Danh sach 63 tinh/thanh VN (truoc sap nhap) - dung lam dropdown checkout va gia tri khop voi
// ShippingRule.provinces. Khach chon dung 1 trong danh sach nay (khong go tu do) de dam bao khop
// chinh xac voi rule admin cau hinh, tranh sai lech chinh ta ("Tp.HCM" vs "TP HCM" vs "Hồ Chí Minh").
export const VN_PROVINCES = [
  "Hà Nội", "TP. Hồ Chí Minh", "Hải Phòng", "Đà Nẵng", "Cần Thơ",
  "An Giang", "Bà Rịa - Vũng Tàu", "Bạc Liêu", "Bắc Giang", "Bắc Kạn",
  "Bắc Ninh", "Bến Tre", "Bình Định", "Bình Dương", "Bình Phước",
  "Bình Thuận", "Cà Mau", "Cao Bằng", "Đắk Lắk", "Đắk Nông",
  "Điện Biên", "Đồng Nai", "Đồng Tháp", "Gia Lai", "Hà Giang",
  "Hà Nam", "Hà Tĩnh", "Hải Dương", "Hậu Giang", "Hòa Bình",
  "Hưng Yên", "Khánh Hòa", "Kiên Giang", "Kon Tum", "Lai Châu",
  "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Long An", "Nam Định",
  "Nghệ An", "Ninh Bình", "Ninh Thuận", "Phú Thọ", "Phú Yên",
  "Quảng Bình", "Quảng Nam", "Quảng Ngãi", "Quảng Ninh", "Quảng Trị",
  "Sóc Trăng", "Sơn La", "Tây Ninh", "Thái Bình", "Thái Nguyên",
  "Thanh Hóa", "Thừa Thiên Huế", "Tiền Giang", "Trà Vinh", "Tuyên Quang",
  "Vĩnh Long", "Vĩnh Phúc", "Yên Bái",
];

export async function listShippingRules(): Promise<ShippingRule[]> {
  return prisma.shippingRule.findMany({ orderBy: { updatedAt: "desc" } });
}

// Rule co "provinces" chua province da chon LUON uu tien hon rule fallback (provinces=[]), bat ke
// thu tu tao/sua - khong dung cot "priority" rieng cho don gian. Neu co nhieu rule cu the cung
// khop (khong nen xay ra neu admin cau hinh dung), lay rule cap nhat gan nhat.
export function findMatchingShippingRule(rules: ShippingRule[], province: string): ShippingRule | null {
  const enabled = rules.filter((r) => r.enabled);
  const specific = enabled.find((r) => r.provinces.includes(province));
  if (specific) return specific;
  return enabled.find((r) => r.provinces.length === 0) ?? null;
}

export function calculateShippingFee(rule: ShippingRule | null, subtotal: number): number {
  if (!rule) return 0;
  if (rule.freeShipThreshold !== null && subtotal >= rule.freeShipThreshold) {
    return 0;
  }
  return rule.baseFee;
}
