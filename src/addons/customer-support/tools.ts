import { MCPTool } from "../../agents/core/ToolRegistry.js";
import { getPluginDb } from "../../services/pluginDb.js";

// Tool cua CSKH agent (customer-support) - dang ky vao ToolRegistry chung (xem backend/index.ts)
// de admin thay/quan ly duoc qua /admin/agents nhu moi tool khac, thay vi chi la 1 mang AiTool[]
// hard-code rieng cua plugin nhu truoc. Ten tool GIU NGUYEN khong doi (search_product, get_product,
// ...) vi day cung la ten function gui cho model qua native function-calling (xem tools trong
// backend/index.ts) - doi ten se lech giua 2 cho.
const pluginDb = getPluginDb("customer-support");

export const searchProductTool: MCPTool = {
  name: "search_product",
  description: 'Tìm kiếm sản phẩm trên website theo tên hoặc từ khoá. Tham số: {"query": "từ khoá"}',
  execute: async (args) => {
    const products = await pluginDb.productCache.findMany({
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
  description: 'Xem chi tiết một sản phẩm (giá, ảnh, tồn kho, mô tả). Tham số: {"productId": "..."}',
  execute: async (args) => {
    const product = await pluginDb.productCache.findUnique({ where: { id: args.productId } });
    return product
      ? JSON.stringify({ name: product.name, price: product.price, salePrice: product.salePrice, inStock: product.stock, imageUrls: product.imageUrls })
      : "Not found";
  },
};

export const checkOrderTool: MCPTool = {
  name: "check_order",
  description: 'Kiểm tra trạng thái đơn hàng bằng số điện thoại hoặc mã đơn. Tham số: {"phoneOrCode": "..."}',
  execute: async (args) => {
    const orders = await pluginDb.cartOrder.findMany({
      where: { OR: [{ customerPhone: args.phoneOrCode }, { id: args.phoneOrCode }] },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    return JSON.stringify(orders.map((o) => ({ code: o.id, status: o.status, date: o.createdAt })));
  },
};

export const createLeadTool: MCPTool = {
  name: "create_lead",
  description: 'Lưu thông tin khách hàng tiềm năng khi họ để lại SĐT hoặc muốn tư vấn/đặt hàng. Tham số: {"name": "tuỳ chọn", "phone": "...", "notes": "tuỳ chọn"}',
  execute: async (args, context) => {
    await pluginDb.$executeRaw`
      INSERT INTO "PluginCustomerSupportLead" ("name", "phone", "notes", "sessionId", "url")
      VALUES (${args.name || null}, ${args.phone}, ${args.notes || null}, ${context.meta?.sessionId || null}, ${context.meta?.url || null})
    `;
    return "Đã lưu thông tin khách hàng thành công. Hãy báo cho khách biết.";
  },
};

export const markAsSpamTool: MCPTool = {
  name: "mark_as_spam",
  description: 'Đánh dấu tin nhắn hiện tại là spam, phá hoại hoặc không liên quan đến mua bán. Tham số: {"reason": "..."}',
  execute: async (_args, context) => {
    // Muon bao ve ngoai (backend/index.ts) biet de dua isSpam vao response tra ve frontend -
    // context la object dung chung/truyen theo tham chieu trong 1 luot request nen ghi lai duoc.
    if (context.meta) context.meta.isSpam = true;
    return "Đã đánh dấu spam. Hãy trả lời ngắn gọn từ chối phục vụ.";
  },
};

export const customerSupportTools: MCPTool[] = [
  searchProductTool,
  getProductTool,
  checkOrderTool,
  createLeadTool,
  markAsSpamTool,
];
