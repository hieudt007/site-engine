import { MCPTool } from "../core/ToolRegistry.js";
import { prisma } from "../../db.js";

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
  markAsSpamTool,
];
