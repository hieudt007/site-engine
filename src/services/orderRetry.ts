import cron from "node-cron";
import { prisma } from "../db.js";
import { sendOrderToLeadbase, LeadbaseOrderError, OrderItemPayload } from "./leadbaseClient.js";

const MAX_ORDER_AGE_HOURS = 24; // quá tuổi này coi như bỏ, cần tenant tự xử lý thủ công

// CartOrder.status='failed' (gọi LeadBase lỗi lúc checkout) - cron nhẹ retry mỗi 5 phút
// (system_design.md §4.1: "không được để mất đơn"). Không có cột đếm số lần retry trong schema
// - dùng tuổi đơn (createdAt) làm giới hạn thay vì đếm lượt, đơn giản hơn và không cần migration.
export function startOrderRetryCron(): void {
  cron.schedule("*/5 * * * *", () => {
    retryFailedOrders().catch((err) => console.error("orderRetry: lỗi không mong đợi", err));
  });
}

export async function retryFailedOrders(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_ORDER_AGE_HOURS * 60 * 60 * 1000);
  const failedOrders = await prisma.cartOrder.findMany({
    where: { status: "failed", createdAt: { gte: cutoff } },
  });

  const domain = await resolveDomain();
  if (!domain) {
    return; // SiteConfig chưa từng được tạo (chưa ai vào /admin lần nào) - chưa biết domain để gửi
  }

  for (const order of failedOrders) {
    try {
      const { orderCode } = await sendOrderToLeadbase({
        domain,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress ?? undefined,
        items: order.items as unknown as OrderItemPayload[],
        total: Number(order.total),
      });
      await prisma.cartOrder.update({
        where: { id: order.id },
        data: { status: "sent_to_leadbase", leadbaseOrderCode: orderCode, sendError: null },
      });
    } catch (err) {
      const message = err instanceof LeadbaseOrderError ? err.message : "Không gọi được LeadBase";
      await prisma.cartOrder.update({ where: { id: order.id }, data: { sendError: message } });
    }
  }
}

async function resolveDomain(): Promise<string | null> {
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
  return siteConfig?.domain ?? null;
}
