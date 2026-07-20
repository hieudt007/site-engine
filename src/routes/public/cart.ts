import { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { renderNotFound } from "../../services/notFoundPage.js";
import { sendOrderToLeadbase, LeadbaseOrderError, OrderItemPayload } from "../../services/leadbaseClient.js";
import { getOrCreateSiteConfig } from "../../services/siteConfig.js";
import { customFieldsSchema } from "../../services/customFields.js";

// Giỏ hàng sống ở localStorage phía trình duyệt (system_design.md task_list — "không cần DB
// riêng cho cart trước khi checkout"), server chỉ tham gia ở 2 điểm: hydrate giá/tên thật cho
// UI giỏ hàng (không tin giá client tự lưu), và POST /cart/checkout tạo CartOrder thật.
const checkoutSchema = z.object({
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
  // Field tu do khach dien qua form checkout (vd "SDT phu") - xem docblock CartOrder.customFields.
  customFields: customFieldsSchema,
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

  app.get("/cart", async (request, reply) => {
    const html = await renderPublic("cart", { pageTitle: "Giỏ hàng" });
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

    const order = await prisma.cartOrder.create({
      data: {
        status: "pending",
        customerName: parsed.data.customerName,
        customerPhone: parsed.data.customerPhone,
        customerAddress: parsed.data.customerAddress,
        items: orderItems as unknown as Prisma.InputJsonValue,
        total,
        ...(parsed.data.customFields ? { customFields: parsed.data.customFields } : {}),
      },
    });

    try {
      const { orderCode } = await sendOrderToLeadbase({
        domain: request.hostname,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress ?? undefined,
        items: orderItems,
        total,
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

    const html = await renderPublic("order-confirmation", { pageTitle: "Xác nhận đơn hàng", order });
    return reply.type("text/html").send(html);
  });
}
