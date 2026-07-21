import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { getPaymentMethod, VnpayConfig } from "../../services/paymentMethods.js";
import { verifyVnpaySignature } from "../../services/vnpay.js";
import { sendOrderToLeadbase, LeadbaseOrderError, OrderItemPayload } from "../../services/leadbaseClient.js";
import { buildFulfillmentNote } from "../../services/fulfillment.js";

async function findOrderByTxnRef(txnRef: string | undefined) {
  if (!txnRef) return null;
  return prisma.cartOrder.findUnique({ where: { vnpayTxnRef: txnRef } });
}

async function getVnpayHashSecret(): Promise<string | null> {
  const method = await getPaymentMethod("vnpay");
  return (method?.config as VnpayConfig | null)?.hashSecret ?? null;
}

// 2 endpoint tach biet vi ly do khac nhau (chuan VNPay):
// - vnp_ReturnUrl: TRINH DUYET khach bi redirect ve day sau khi thanh toan - chi de HIEN THI, co
//   the bi bo qua (dong tab) hoac gia mao param, KHONG duoc dung de chot da thanh toan that.
// - vnp_IpnUrl (cau hinh trong merchant portal VNPay): VNPay goi server-to-server, day moi la
//   nguon xac thuc THAT de cap nhat paymentStatus + gui don sang LeadBase.
export async function registerVnpayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string> }>("/payment/vnpay/return", async (request, reply) => {
    const query = request.query;
    const order = await findOrderByTxnRef(query.vnp_TxnRef);
    if (!order) {
      return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy đơn hàng"));
    }

    const hashSecret = await getVnpayHashSecret();
    const valid = hashSecret ? verifyVnpaySignature(query, hashSecret) : false;
    const looksSuccessful = valid && query.vnp_ResponseCode === "00";

    return reply.redirect(`/order-confirmation/${order.id}${looksSuccessful ? "" : "?vnpay=pending"}`);
  });

  app.get<{ Querystring: Record<string, string> }>("/payment/vnpay/ipn", async (request, reply) => {
    const query = request.query;
    const hashSecret = await getVnpayHashSecret();
    if (!hashSecret || !verifyVnpaySignature(query, hashSecret)) {
      return reply.send({ RspCode: "97", Message: "Invalid signature" });
    }

    const order = await findOrderByTxnRef(query.vnp_TxnRef);
    if (!order) {
      return reply.send({ RspCode: "01", Message: "Order not found" });
    }

    const expectedAmount = String(
      (Math.round(Number(order.total)) - order.discountAmount + order.shippingFee) * 100,
    );
    if (expectedAmount !== query.vnp_Amount) {
      return reply.send({ RspCode: "04", Message: "Invalid amount" });
    }

    if (order.paymentStatus !== "unpaid") {
      return reply.send({ RspCode: "02", Message: "Order already confirmed" });
    }

    if (query.vnp_ResponseCode !== "00") {
      await prisma.cartOrder.update({ where: { id: order.id }, data: { paymentStatus: "failed" } });
      return reply.send({ RspCode: "00", Message: "Confirm Success" });
    }

    await prisma.cartOrder.update({
      where: { id: order.id },
      data: { paymentStatus: "paid", paidAt: new Date() },
    });

    try {
      const { orderCode } = await sendOrderToLeadbase({
        domain: request.hostname,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress ?? undefined,
        customerProvince: order.customerProvince ?? undefined,
        items: order.items as unknown as OrderItemPayload[],
        total: Number(order.total),
        shippingFee: order.shippingFee,
        discountAmount: order.discountAmount,
        fulfillmentNote: await buildFulfillmentNote(order),
      });
      await prisma.cartOrder.update({
        where: { id: order.id },
        data: { status: "sent_to_leadbase", leadbaseOrderCode: orderCode },
      });
    } catch (err) {
      const message = err instanceof LeadbaseOrderError ? err.message : "Không gọi được LeadBase";
      request.log.error(err);
      await prisma.cartOrder.update({ where: { id: order.id }, data: { status: "failed", sendError: message } });
      // Khong bao loi cho VNPay - da thu tien that, cron retry (orderRetry.ts) chi retry status='failed'
      // KHONG phan biet paymentMethod nen se tu gui lai binh thuong.
    }

    return reply.send({ RspCode: "00", Message: "Confirm Success" });
  });
}
