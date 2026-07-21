import { prisma } from "../db.js";
import type { FulfillmentMethod, Store } from "@prisma/client";

export const FULFILLMENT_METHOD_KEYS = ["delivery", "pickup"] as const;
export type FulfillmentMethodKey = (typeof FULFILLMENT_METHOD_KEYS)[number];

export async function ensureFulfillmentMethodRows(): Promise<void> {
  for (const method of FULFILLMENT_METHOD_KEYS) {
    await prisma.fulfillmentMethod.upsert({
      where: { method },
      create: { method, enabled: true },
      update: {},
    });
  }
}

export async function listFulfillmentMethods(): Promise<FulfillmentMethod[]> {
  await ensureFulfillmentMethodRows();
  return prisma.fulfillmentMethod.findMany({ orderBy: { method: "asc" } });
}

export async function isFulfillmentMethodEnabled(method: FulfillmentMethodKey): Promise<boolean> {
  const row = await prisma.fulfillmentMethod.findUnique({ where: { method } });
  return row?.enabled ?? true;
}

export async function listEnabledStores(): Promise<Store[]> {
  return prisma.store.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
}

// LeadBase khong co khai niem "cua hang pickup" rieng - ghi thanh 1 dong note kem theo don de
// nhan vien biet giao hay khach tu den lay, dung chung cho ca luc tao don (cart.ts) lan retry
// (orderRetry.ts) va IPN VNPay (routes/public/vnpay.ts).
export async function buildFulfillmentNote(order: {
  fulfillmentMethod: string;
  storeId: string | null;
}): Promise<string | undefined> {
  if (order.fulfillmentMethod !== "pickup" || !order.storeId) {
    return undefined;
  }
  const store = await prisma.store.findUnique({ where: { id: order.storeId } });
  if (!store) {
    return undefined;
  }
  return `Nhận tại cửa hàng: ${store.name} - ${store.address}`;
}
