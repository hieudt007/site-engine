import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { renderPublic } from "../../services/themeRenderer.js";
import { sendOrderToLeadbase, LeadbaseOrderError } from "../../services/leadbaseClient.js";

// Giỏ hàng sống ở localStorage phía trình duyệt (system_design.md task_list — "không cần DB
// riêng cho cart trước khi checkout"), server chỉ tham gia ở 2 điểm: hydrate giá/tên thật cho
// UI giỏ hàng (không tin giá client tự lưu), và POST /cart/checkout tạo CartOrder thật.
const checkoutSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1) })).min(1),
  customerName: z.string().min(1),
  customerPhone: z.string().min(1),
  customerAddress: z.string().optional(),
});

export async function registerCartRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { ids?: string } }>("/api/cart/products", async (request) => {
    const ids = (request.query.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return { products: [] };
    }
    const products = await prisma.productCache.findMany({
      where: { id: { in: ids }, publishStatus: "published" },
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

    const productIds = parsed.data.items.map((i) => i.productId);
    const products = await prisma.productCache.findMany({
      where: { id: { in: productIds }, publishStatus: "published" },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const orderItems = [];
    let total = 0;
    for (const item of parsed.data.items) {
      const product = productById.get(item.productId);
      if (!product) {
        return reply.code(422).send({ error: `Sản phẩm ${item.productId} không tồn tại hoặc chưa xuất bản` });
      }
      const unitPrice = product.salePrice ? Number(product.salePrice) : Number(product.price);
      orderItems.push({
        leadbaseProductId: product.leadbaseProductId,
        name: product.name,
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
        items: orderItems,
        total,
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
      return reply.code(404).type("text/html").send("<h1>404 - Không tìm thấy đơn hàng</h1>");
    }

    const html = await renderPublic("order-confirmation", { pageTitle: "Xác nhận đơn hàng", order });
    return reply.type("text/html").send(html);
  });
}
