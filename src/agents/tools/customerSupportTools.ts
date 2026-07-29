import { Prisma } from "@prisma/client";
import { MCPTool } from "../core/ToolRegistry.js";
import { prisma } from "../../db.js";
import { sendOrderToLeadbase, LeadbaseOrderError, OrderItemPayload } from "../../services/leadbaseClient.js";
import { VN_PROVINCES, listShippingRules, findMatchingShippingRule, calculateShippingFee } from "../../services/shipping.js";

// Tool cua AI CSKH (agent key="customer") - truoc day thuoc plugin "customer-support" (chay code
// khong sandbox, tu do doc/ghi/xoa moi thu - xem ly do go bo plugin trong lich su commit). Gio la
// core feature, dung thang prisma that (khong can getPluginDb nua vi khong con la code plugin).
export const searchProductTool: MCPTool = {
  name: "search_product",
  description: '{"query": "keyword"}',
  execute: async (args) => {
    const products = await prisma.productCache.findMany({
      where: { name: { contains: args.query, mode: "insensitive" } },
      take: 5,
    });
    return JSON.stringify(
      products.map((p) => ({ id: p.id, name: p.name, price: p.price, salePrice: p.salePrice, imageUrl: p.imageUrls?.[0] }))
    );
  },
};

export const getProductTool: MCPTool = {
  name: "get_product",
  description: 'View product detail (price, images, stock, description). {"productId": "..."}',
  execute: async (args) => {
    const product = await prisma.productCache.findUnique({ where: { id: args.productId } });
    return product
      ? JSON.stringify({ name: product.name, price: product.price, salePrice: product.salePrice, inStock: product.stock, imageUrls: product.imageUrls })
      : "Not found";
  },
};

export const checkOrderTool: MCPTool = {
  name: "check_order",
  description: 'Check order status by phone number or order code. {"phoneOrCode": "..."}',
  execute: async (args) => {
    const orders = await prisma.cartOrder.findMany({
      where: { OR: [{ customerPhone: args.phoneOrCode }, { id: args.phoneOrCode }] },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return JSON.stringify(orders.map((o) => ({ code: o.id, status: o.status, date: o.createdAt })));
  },
};

export const createLeadTool: MCPTool = {
  name: "create_lead",
  description: 'Save lead info when customer leaves phone number or wants a quote/order. {"name": "optional", "phone": "...", "notes": "optional"}',
  execute: async (args, context) => {
    await prisma.customerChatLead.create({
      data: {
        name: args.name || null,
        phone: args.phone,
        notes: args.notes || null,
        sessionId: context.meta?.sessionId || null,
        url: context.meta?.url || null,
      },
    });
    return "Lead saved. Let the customer know.";
  },
};

// Tao DON HANG THAT (CartOrder, cung bang/luong voi checkout binh thuong o routes/public/cart.ts)
// khi khach chot mua qua chat CO DAY DU dia chi giao hang - KHONG phai chi luu "y dinh" nhu
// create_lead, don nay duoc gui thang sang LeadBase giong 1 don checkout that su. Luon dung
// fulfillmentMethod="delivery" + paymentMethod="cod" (chat khong co buoc redirect thanh toan
// vnpay) - AI PHAI goi search_product/get_product truoc de lay dung productId (id thuc trong DB,
// khong phai ten san pham).
export const createOrderTool: MCPTool = {
  name: "create_order",
  description:
    'Create a REAL order (sent to LeadBase, same as checkout) when customer confirms purchase with a FULL delivery address. Call search_product/get_product FIRST to get the correct productId - never guess it. Only call after the customer has explicitly confirmed items, name, phone, and full address. {"customerName": "...", "customerPhone": "...", "customerAddress": "...", "customerProvince": "exact Vietnamese province name", "items": [{"productId": "...", "quantity": 1}]}',
  execute: async (args, context) => {
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length === 0) return "Error: items is required (call search_product/get_product first to get productId).";
    if (!args.customerName || !args.customerPhone || !args.customerAddress || !args.customerProvince) {
      return "Error: customerName, customerPhone, customerAddress, customerProvince are all required.";
    }
    if (!(VN_PROVINCES as readonly string[]).includes(args.customerProvince)) {
      return `Error: customerProvince must be exactly one of: ${VN_PROVINCES.join(", ")}`;
    }

    const productIds = items.map((i: any) => String(i.productId));
    const products = await prisma.productCache.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    const orderItems: OrderItemPayload[] = [];
    let total = 0;
    for (const item of items) {
      const product = productById.get(String(item.productId));
      if (!product) return `Error: product [${item.productId}] not found - call search_product again to get the correct id, do not guess.`;
      if (product.leadbaseStatus !== "selling") return `Error: product "${product.name}" is no longer selling.`;
      const quantity = Number(item.quantity) > 0 ? Math.floor(Number(item.quantity)) : 1;
      const unitPrice = product.salePrice ? Number(product.salePrice) : Number(product.price);
      orderItems.push({ leadbaseProductId: product.leadbaseProductId, name: product.name, price: unitPrice, quantity });
      total += unitPrice * quantity;
    }

    const shippingRules = await listShippingRules();
    const matchedRule = findMatchingShippingRule(shippingRules, args.customerProvince);
    const shippingFee = calculateShippingFee(matchedRule, total);

    const order = await prisma.cartOrder.create({
      data: {
        status: "pending",
        customerName: args.customerName,
        customerPhone: args.customerPhone,
        customerAddress: args.customerAddress,
        customerProvince: args.customerProvince,
        fulfillmentMethod: "delivery",
        items: orderItems as unknown as Prisma.InputJsonValue,
        total,
        shippingFee,
        paymentMethod: "cod",
      },
    });

    // Gui LeadBase giong het checkout that (routes/public/cart.ts) - loi thi luu status "failed",
    // KHONG nem loi tra ve AI/khach (don da luu that, cron retry - services/orderRetry.ts - se tu
    // gui lai), chi bao AI biet de van xac nhan don voi khach binh thuong.
    let leadbaseNote = "";
    try {
      const hostname = context.meta?.hostname;
      if (!hostname) throw new LeadbaseOrderError("Thiếu hostname trong context - không xác định được Website.");
      const { orderCode } = await sendOrderToLeadbase({
        domain: hostname,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress ?? undefined,
        customerProvince: order.customerProvince ?? undefined,
        items: orderItems,
        total,
        shippingFee,
        fulfillmentMethod: "delivery",
        discountAmount: 0,
      });
      await prisma.cartOrder.update({ where: { id: order.id }, data: { status: "sent_to_leadbase", leadbaseOrderCode: orderCode } });
    } catch (err) {
      const message = err instanceof LeadbaseOrderError ? err.message : "Không gọi được LeadBase";
      await prisma.cartOrder.update({ where: { id: order.id }, data: { status: "failed", sendError: message } });
      leadbaseNote = " (Hệ thống sẽ tự đồng bộ lại đơn với LeadBase sau, không cần báo lỗi này cho khách.)";
    }

    return `Order created: id=${order.id}, subtotal=${total}đ, shippingFee=${shippingFee}đ, grandTotal=${total + shippingFee}đ.${leadbaseNote} Confirm the order with the customer and mention the order id as reference.`;
  },
};

export const markAsSpamTool: MCPTool = {
  name: "mark_as_spam",
  description: 'Mark current message as spam/abuse/unrelated to sales. {"reason": "..."}',
  execute: async (_args, context) => {
    // Muon bao ve ngoai (routes/public/customerChat.ts) biet de dua isSpam vao response tra ve
    // frontend - context la object dung chung/truyen theo tham chieu trong 1 luot request nen
    // ghi lai duoc.
    if (context.meta) context.meta.isSpam = true;
    return "Marked as spam. Reply briefly declining service.";
  },
};

export const customerSupportTools: MCPTool[] = [
  searchProductTool,
  getProductTool,
  checkOrderTool,
  createLeadTool,
  createOrderTool,
  markAsSpamTool,
];
