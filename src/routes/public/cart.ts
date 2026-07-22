import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { sendOrderToLeadbase, LeadbaseOrderError, OrderItemPayload } from "../../services/leadbaseClient.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";
import { customFieldsSchema } from "../../services/customFields.js";
import { getPaymentMethod, listPaymentMethods, PAYMENT_METHOD_KEYS, VnpayConfig } from "../../services/paymentMethods.js";
import { buildVnpayPaymentUrl } from "../../services/vnpay.js";
import { calculateShippingFee, findMatchingShippingRule, listShippingRules, VN_PROVINCES } from "../../services/shipping.js";
import { buildFulfillmentNote, FULFILLMENT_METHOD_KEYS, isFulfillmentMethodEnabled, listEnabledStores, listFulfillmentMethods } from "../../services/fulfillment.js";
import { incrementCouponUsage, validateCoupon } from "../../services/coupon.js";

// Giỏ hàng sống ở localStorage phía trình duyệt (system_design.md task_list — "không cần DB
// riêng cho cart trước khi checkout"), server chỉ tham gia ở 2 điểm: hydrate giá/tên thật cho
// UI giỏ hàng (không tin giá client tự lưu), và POST /cart/checkout tạo CartOrder thật.
// customerProvince BAT BUOC khi 'delivery', storeId BAT BUOC khi 'pickup' - dung superRefine thay
// vi discriminatedUnion vi 2 nhanh chia se qua nhieu field chung (items/customerName/...).
const checkoutSchema = z
  .object({
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          variantId: z.string().min(1).optional(),
          quantity: z.number().int().min(1),
        }),
      )
      .min(1),
    customerName: z.string().min(1),
    customerPhone: z.string().min(1),
    customerAddress: z.string().optional(),
    customerProvince: z.enum(VN_PROVINCES as [string, ...string[]]).optional(),
    fulfillmentMethod: z.enum(FULFILLMENT_METHOD_KEYS),
    storeId: z.string().min(1).optional(),
    paymentMethod: z.enum(PAYMENT_METHOD_KEYS),
    couponCode: z.string().min(1).optional(),
    // Field tu do khach dien qua form checkout (vd "SDT phu") - xem docblock CartOrder.customFields.
    customFields: customFieldsSchema,
  })
  .superRefine((data, ctx) => {
    if (data.fulfillmentMethod === "delivery" && !data.customerProvince) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerProvince"], message: "Vui lòng chọn tỉnh/thành" });
    }
    if (data.fulfillmentMethod === "pickup" && !data.storeId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["storeId"], message: "Vui lòng chọn cửa hàng" });
    }
  });

export async function registerCartRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { ids?: string } }>("/api/cart/products", async (request) => {
    const ids = (request.query.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return { products: [] };
    }
    const products = await prisma.productCache.findMany({
      where: { id: { in: ids }, status: "published" },
      include: { variants: true },
    });
    return { products };
  });

  // Cong khai - chi tra 'enabled' + config CONG KHAI (thong tin ngan hang de hien thi), KHONG
  // BAO GIO tra tmnCode/hashSecret cua vnpay (khac /admin/api/payment-methods, doi requireRole).
  app.get("/api/cart/payment-methods", async () => {
    const methods = await listPaymentMethods();
    return {
      methods: methods
        .filter((m) => m.enabled)
        .map((m) => ({ method: m.method, config: m.method === "vnpay" ? undefined : m.config })),
    };
  });

  app.get("/api/cart/fulfillment-methods", async () => {
    const methods = await listFulfillmentMethods();
    const stores = await listEnabledStores();
    return {
      methods: methods.filter((m) => m.enabled).map((m) => m.method),
      stores,
    };
  });

  app.get("/cart", async (request, reply) => {
    const html = await renderPublic("cart", {
      pageTitle: "Giỏ hàng",
      breadcrumbs: [
        { name: "Trang chủ", url: "/" },
        { name: "Sản phẩm", url: "/products" },
        { name: "Giỏ hàng", url: "/cart" },
      ],
      breadcrumbVariant: "product",
    });
    return reply.type("text/html").send(html);
  });

  app.post("/cart/checkout", async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    // Đảm bảo SiteConfig singleton tồn tại ngay từ đơn hàng ĐẦU TIÊN - orderRetry.ts cần
    // domain của chính instance này để retry, không thể đợi tới lần đầu admin vào Settings.
    await getOrCreateSiteConfig(request.hostname);

    const productIds = parsed.data.items.map((i) => i.productId);
    const products = await prisma.productCache.findMany({
      where: { id: { in: productIds }, status: "published" },
      include: { variants: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const orderItems: OrderItemPayload[] = [];
    let total = 0;
    for (const item of parsed.data.items) {
      const product = productById.get(item.productId);
      if (!product) {
        return reply.code(422).send({ error: `Sản phẩm ${item.productId} không tồn tại hoặc chưa xuất bản` });
      }

      let unitPrice: number;
      let displayName = product.name;
      let leadbaseVariantId: string | undefined;

      if (item.variantId) {
        const variant = product.variants.find((v) => v.id === item.variantId);
        if (!variant) {
          return reply.code(422).send({ error: `Biến thể ${item.variantId} không tồn tại` });
        }
        unitPrice = variant.salePrice ? Number(variant.salePrice) : Number(variant.price);
        const attrs = (variant.attributes as Record<string, string> | null) ?? {};
        const attrText = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(", ");
        displayName = attrText ? `${product.name} - ${attrText}` : product.name;
        leadbaseVariantId = variant.leadbaseVariantId;
      } else {
        unitPrice = product.salePrice ? Number(product.salePrice) : Number(product.price);
      }

      orderItems.push({
        leadbaseProductId: product.leadbaseProductId,
        leadbaseVariantId,
        name: displayName,
        price: unitPrice,
        quantity: item.quantity,
      });
      total += unitPrice * item.quantity;
    }

    const fulfillmentEnabled = await isFulfillmentMethodEnabled(parsed.data.fulfillmentMethod);
    if (!fulfillmentEnabled) {
      return reply.code(422).send({ error: "Hình thức nhận hàng này hiện không khả dụng" });
    }

    let shippingFee = 0;
    if (parsed.data.fulfillmentMethod === "delivery") {
      const shippingRules = await listShippingRules();
      const matchedRule = findMatchingShippingRule(shippingRules, parsed.data.customerProvince!);
      shippingFee = calculateShippingFee(matchedRule, total);
    } else {
      const store = await prisma.store.findUnique({ where: { id: parsed.data.storeId! } });
      if (!store || !store.enabled) {
        return reply.code(422).send({ error: "Cửa hàng không tồn tại hoặc đã ngừng hoạt động" });
      }
    }

    let discountAmount = 0;
    if (parsed.data.couponCode) {
      const couponResult = await validateCoupon(parsed.data.couponCode, total);
      if (!couponResult.ok) {
        return reply.code(422).send({ error: couponResult.error });
      }
      discountAmount = couponResult.discountAmount ?? 0;
    }

    const grandTotal = total - discountAmount + shippingFee;

    const order = await prisma.cartOrder.create({
      data: {
        status: "pending",
        customerName: parsed.data.customerName,
        customerPhone: parsed.data.customerPhone,
        customerAddress: parsed.data.customerAddress,
        customerProvince: parsed.data.customerProvince,
        fulfillmentMethod: parsed.data.fulfillmentMethod,
        storeId: parsed.data.storeId,
        items: orderItems as unknown as Prisma.InputJsonValue,
        total,
        shippingFee,
        couponCode: parsed.data.couponCode,
        discountAmount,
        paymentMethod: parsed.data.paymentMethod,
        ...(parsed.data.customFields ? { customFields: parsed.data.customFields } : {}),
      },
    });

    if (parsed.data.couponCode) {
      await incrementCouponUsage(parsed.data.couponCode);
    }

    // vnpay: KHONG gui LeadBase ngay - doi IPN xac nhan da thanh toan that (routes/public/vnpay.ts)
    // moi coi la don hop le, tranh don "sent_to_leadbase" nhung khach chua tra tien.
    if (parsed.data.paymentMethod === "vnpay") {
      const vnpayMethod = await getPaymentMethod("vnpay");
      if (!vnpayMethod?.enabled) {
        return reply.code(422).send({ error: "VNPay chưa được bật, vui lòng chọn phương thức khác" });
      }

      const txnRef = `${order.id}-${Date.now()}`;
      await prisma.cartOrder.update({ where: { id: order.id }, data: { vnpayTxnRef: txnRef } });

      const redirectUrl = buildVnpayPaymentUrl({
        config: (vnpayMethod.config ?? {}) as VnpayConfig,
        orderId: txnRef,
        amount: grandTotal,
        ipAddr: request.ip,
        returnUrl: `${request.protocol}://${request.hostname}/payment/vnpay/return`,
        orderInfo: `Thanh toan don hang ${order.id}`,
      });

      return reply.code(201).send({ orderId: order.id, redirectUrl });
    }

    try {
      const { orderCode } = await sendOrderToLeadbase({
        domain: request.hostname,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress ?? undefined,
        customerProvince: order.customerProvince ?? undefined,
        items: orderItems,
        total,
        shippingFee,
        discountAmount,
        fulfillmentNote: await buildFulfillmentNote(order),
      });
      await prisma.cartOrder.update({
        where: { id: order.id },
        data: { status: "sent_to_leadbase", leadbaseOrderCode: orderCode },
      });
    } catch (err) {
      const message = err instanceof LeadbaseOrderError ? err.message : "Không gọi được LeadBase";
      request.log.error(err);
      await prisma.cartOrder.update({
        where: { id: order.id },
        data: { status: "failed", sendError: message },
      });
      // Không trả lỗi cho khách - đơn đã lưu, cron retry (services/orderRetry.ts) sẽ gửi lại.
    }

    return reply.code(201).send({ orderId: order.id });
  });

  app.get<{ Params: { id: string } }>("/order-confirmation/:id", async (request, reply) => {
    const order = await prisma.cartOrder.findUnique({ where: { id: request.params.id } });
    if (!order) {
      return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy đơn hàng"));
    }

    let bankInfo = null;
    if (order.paymentMethod === "bank_transfer") {
      const bankMethod = await getPaymentMethod("bank_transfer");
      bankInfo = bankMethod?.config ?? null;
    }

    const pickupStore = order.storeId ? await prisma.store.findUnique({ where: { id: order.storeId } }) : null;

    const html = await renderPublic("order-confirmation", {
      pageTitle: "Xác nhận đơn hàng",
      breadcrumbs: [
        { name: "Trang chủ", url: "/" },
        { name: "Giỏ hàng", url: "/cart" },
        { name: "Xác nhận đơn hàng", url: `/order-confirmation/${order.id}` },
      ],
      breadcrumbVariant: "product",
      order,
      bankInfo,
      pickupStore,
    });
    return reply.type("text/html").send(html);
  });
}
