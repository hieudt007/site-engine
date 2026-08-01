import crypto from "node:crypto";
import Fastify from "fastify";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";

// /payment/vnpay/ipn la nguon xac thuc THAT DUY NHAT de chot 1 don da duoc thanh toan (khac
// /payment/vnpay/return - browser redirect, khong dang tin cay, xem ghi chu trong vnpay.ts/route).
// Mock sendOrderToLeadbase (goi mang that ra ngoai) - can Redis THAT (CacheService.getPaymentMethods)
// nen chi chay duoc tren CI hoac may co Redis local dang chay.
vi.mock("../services/leadbaseClient.js", () => ({
  sendOrderToLeadbase: vi.fn().mockResolvedValue({ orderCode: "LB-TEST-001" }),
  LeadbaseOrderError: class LeadbaseOrderError extends Error {},
}));

const { sendOrderToLeadbase } = await import("../services/leadbaseClient.js");
const { registerVnpayRoutes } = await import("../routes/public/vnpay.js");

const HASH_SECRET = "test-vnpay-hash-secret";

function sign(params: Record<string, string>): string {
  const signData = Object.keys(params).sort().map((k) => `${encodeURIComponent(k).replace(/%20/g, "+")}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`).join("&");
  return crypto.createHmac("sha512", HASH_SECRET).update(signData).digest("hex");
}

async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  await registerVnpayRoutes(app);
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });
  await app.ready();
  return app;
}

describe("GET /payment/vnpay/ipn", () => {
  const suffix = Date.now();
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orderId: string;
  const txnRef = `txn-${suffix}`;
  const orderTotal = 100000;

  beforeAll(async () => {
    app = await buildTestApp();
    await prisma.paymentMethod.upsert({
      where: { method: "vnpay" },
      update: { enabled: true, config: { tmnCode: "TESTTMN", hashSecret: HASH_SECRET, sandbox: true } },
      create: { method: "vnpay", enabled: true, config: { tmnCode: "TESTTMN", hashSecret: HASH_SECRET, sandbox: true } },
    });
    const order = await prisma.cartOrder.create({
      data: {
        status: "pending",
        customerName: "Test Customer",
        customerPhone: "0900000000",
        items: [{ leadbaseProductId: "p1", name: "Test", price: orderTotal, quantity: 1 }],
        total: orderTotal,
        paymentMethod: "vnpay",
        paymentStatus: "unpaid",
        vnpayTxnRef: txnRef,
      },
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.cartOrder.delete({ where: { id: orderId } }).catch(() => {});
    await app.close();
  });

  function baseParams(overrides: Record<string, string> = {}) {
    return {
      vnp_TxnRef: txnRef,
      vnp_Amount: String(orderTotal * 100),
      vnp_ResponseCode: "00",
      ...overrides,
    };
  }

  it("rejects an invalid signature (RspCode 97)", async () => {
    const res = await app.inject({ method: "GET", url: `/payment/vnpay/ipn?vnp_TxnRef=${txnRef}&vnp_SecureHash=wrong` });
    expect(res.json()).toMatchObject({ RspCode: "97" });
  }, 20_000);

  it("rejects an unknown vnp_TxnRef (RspCode 01)", async () => {
    const params = baseParams({ vnp_TxnRef: "does-not-exist" });
    const query = new URLSearchParams({ ...params, vnp_SecureHash: sign(params) }).toString();
    const res = await app.inject({ method: "GET", url: `/payment/vnpay/ipn?${query}` });
    expect(res.json()).toMatchObject({ RspCode: "01" });
  }, 20_000);

  // Chan gia mao so tien: du chu ky dung (VD replay 1 IPN cu voi TxnRef that) nhung amount khong
  // khop tong don trong DB thi PHAI tu choi, khong duoc tin amount tu query.
  it("rejects a mismatched amount (RspCode 04)", async () => {
    const params = baseParams({ vnp_Amount: "1" });
    const query = new URLSearchParams({ ...params, vnp_SecureHash: sign(params) }).toString();
    const res = await app.inject({ method: "GET", url: `/payment/vnpay/ipn?${query}` });
    expect(res.json()).toMatchObject({ RspCode: "04" });
  }, 20_000);

  it("confirms payment, marks the order paid, and forwards it to LeadBase on a valid successful IPN", async () => {
    const params = baseParams();
    const query = new URLSearchParams({ ...params, vnp_SecureHash: sign(params) }).toString();
    const res = await app.inject({ method: "GET", url: `/payment/vnpay/ipn?${query}` });
    expect(res.json()).toMatchObject({ RspCode: "00" });

    const updated = await prisma.cartOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.paymentStatus).toBe("paid");
    expect(updated.status).toBe("sent_to_leadbase");
    expect(updated.leadbaseOrderCode).toBe("LB-TEST-001");
    expect(sendOrderToLeadbase).toHaveBeenCalled();
  }, 20_000);

  it("rejects a replayed IPN for an order that's already confirmed (RspCode 02)", async () => {
    const params = baseParams();
    const query = new URLSearchParams({ ...params, vnp_SecureHash: sign(params) }).toString();
    const res = await app.inject({ method: "GET", url: `/payment/vnpay/ipn?${query}` });
    expect(res.json()).toMatchObject({ RspCode: "02" });
  }, 20_000);
});
