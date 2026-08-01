import Fastify from "fastify";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { prisma } from "../db.js";

// POST /cart/checkout tao don hang THAT (tien that, gui LeadBase that) - khach KHONG gui gia len
// server (chi gui productId/qty), server luon tu tra gia THAT tu DB (ProductCache.price/salePrice)
// - day la diem chan chinh chong gia mao gia. Mock sendOrderToLeadbase (mang that ra ngoai). Can
// Redis THAT (CacheService.getFulfillmentMethods/getStores/getCoupons/getPaymentMethods) nen chi
// chay duoc tren CI hoac may co Redis local.
vi.mock("../services/leadbaseClient.js", () => ({
  sendOrderToLeadbase: vi.fn().mockResolvedValue({ orderCode: "LB-CART-001" }),
  LeadbaseOrderError: class LeadbaseOrderError extends Error {},
}));

const { sendOrderToLeadbase } = await import("../services/leadbaseClient.js");
const { registerCartRoutes } = await import("../routes/public/cart.js");

async function buildTestApp() {
  const app = Fastify({ logger: false, trustProxy: true });
  await registerCartRoutes(app);
  app.setErrorHandler((error: any, _request, reply) => {
    if (error.statusCode) return reply.code(error.statusCode).send({ message: error.message });
    return reply.code(500).send({ message: "Internal Server Error" });
  });
  await app.ready();
  return app;
}

describe("POST /cart/checkout", () => {
  const suffix = Date.now();
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let publishedProductId: string;
  let draftProductId: string;
  let discontinuedProductId: string;

  const basePayload = {
    customerName: "Nguyen Van A",
    customerPhone: "0900000001",
    fulfillmentMethod: "delivery" as const,
    customerProvince: "Hà Nội",
    paymentMethod: "cod" as const,
  };

  beforeAll(async () => {
    app = await buildTestApp();

    const published = await prisma.productCache.create({
      data: { leadbaseProductId: `lb-cart-${suffix}-1`, price: 150000, leadbaseStatus: "selling", name: "Published Product", status: "published" },
    });
    publishedProductId = published.id;

    const draft = await prisma.productCache.create({
      data: { leadbaseProductId: `lb-cart-${suffix}-2`, price: 150000, leadbaseStatus: "selling", name: "Draft Product", status: "draft" },
    });
    draftProductId = draft.id;

    const discontinued = await prisma.productCache.create({
      data: { leadbaseProductId: `lb-cart-${suffix}-3`, price: 150000, leadbaseStatus: "discontinued", name: "Discontinued Product", status: "published" },
    });
    discontinuedProductId = discontinued.id;
  });

  afterAll(async () => {
    await prisma.cartOrder.deleteMany({ where: { customerPhone: basePayload.customerPhone } }).catch(() => {});
    await prisma.productCache.delete({ where: { id: publishedProductId } }).catch(() => {});
    await prisma.productCache.delete({ where: { id: draftProductId } }).catch(() => {});
    await prisma.productCache.delete({ where: { id: discontinuedProductId } }).catch(() => {});
    await app.close();
  });

  it("rejects a checkout referencing a draft (unpublished) product", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/cart/checkout",
      payload: { ...basePayload, items: [{ productId: draftProductId, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(422);
  }, 20_000);

  it("rejects a checkout referencing a discontinued (leadbaseStatus != selling) product", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/cart/checkout",
      payload: { ...basePayload, items: [{ productId: discontinuedProductId, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(422);
  }, 20_000);

  it("rejects checkout missing customerProvince for delivery fulfillment", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/cart/checkout",
      payload: { ...basePayload, customerProvince: undefined, items: [{ productId: publishedProductId, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(422);
  }, 20_000);

  // Chan gia mao gia: server PHAI tu tinh total tu ProductCache.price * quantity trong DB, khong
  // duoc nhan bat ky truong "price"/"total" nao tu client (schema thuc te khong nhan field do,
  // nhung day la bang chung hanh vi that: don duoc tao voi dung gia * so luong tu DB).
  it("computes the order total from the DB price (not anything the client could send)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/cart/checkout",
      payload: { ...basePayload, items: [{ productId: publishedProductId, quantity: 2 }] },
    });
    expect(res.statusCode).toBe(201);
    const orderId = res.json().orderId;

    const order = await prisma.cartOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(Number(order.total)).toBe(150000 * 2);
    expect(order.status).toBe("sent_to_leadbase");
    expect(sendOrderToLeadbase).toHaveBeenCalled();
  }, 20_000);

  it("defers sending to LeadBase for vnpay orders until IPN confirms payment", async () => {
    await prisma.paymentMethod.upsert({
      where: { method: "vnpay" },
      update: { enabled: true, config: { tmnCode: "TESTTMN", hashSecret: "test-secret", sandbox: true } },
      create: { method: "vnpay", enabled: true, config: { tmnCode: "TESTTMN", hashSecret: "test-secret", sandbox: true } },
    });
    vi.mocked(sendOrderToLeadbase).mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/cart/checkout",
      payload: { ...basePayload, paymentMethod: "vnpay", items: [{ productId: publishedProductId, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().redirectUrl).toContain("vnp_TxnRef");
    expect(sendOrderToLeadbase).not.toHaveBeenCalled();

    const order = await prisma.cartOrder.findUniqueOrThrow({ where: { id: res.json().orderId } });
    expect(order.status).toBe("pending");
    expect(order.paymentStatus).toBe("unpaid");

    await prisma.paymentMethod.update({ where: { method: "vnpay" }, data: { enabled: false } });
  }, 20_000);
});
