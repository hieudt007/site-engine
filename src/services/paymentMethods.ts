import { prisma } from "../db.js";
import type { PaymentMethod } from "@prisma/client";

export const PAYMENT_METHOD_KEYS = ["cod", "bank_transfer", "vnpay"] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export interface BankTransferConfig {
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  branch?: string;
  qrImage?: string;
}

export interface VnpayConfig {
  tmnCode?: string;
  hashSecret?: string;
  sandbox?: boolean;
}

// Dam bao du 3 row 'cod'/'bank_transfer'/'vnpay' luon ton tai (mac dinh enabled=false) de trang
// Settings -> Thanh toan luon hien du 3 the ngay ca truoc khi admin luu lan nao - tranh phai upsert
// rai rac o nhieu noi.
export async function ensurePaymentMethodRows(): Promise<void> {
  for (const method of PAYMENT_METHOD_KEYS) {
    await prisma.paymentMethod.upsert({
      where: { method },
      create: { method, enabled: false },
      update: {},
    });
  }
}

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  await ensurePaymentMethodRows();
  return prisma.paymentMethod.findMany({ orderBy: { method: "asc" } });
}

export async function getEnabledPaymentMethodKeys(): Promise<PaymentMethodKey[]> {
  const rows = await prisma.paymentMethod.findMany({ where: { enabled: true } });
  return rows.map((r) => r.method as PaymentMethodKey);
}

export async function getPaymentMethod(method: PaymentMethodKey): Promise<PaymentMethod | null> {
  return prisma.paymentMethod.findUnique({ where: { method } });
}
