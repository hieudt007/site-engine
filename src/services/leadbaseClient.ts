import { config } from "../config.js";
import { signSiteEngineRequest } from "../security.js";

export interface OrderItemPayload {
  leadbaseProductId: string;
  leadbaseVariantId?: string;
  name: string;
  price: number;
  quantity: number;
}

export interface SendOrderInput {
  domain: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerProvince?: string;
  items: OrderItemPayload[];
  total: number;
  shippingFee?: number;
  discountAmount?: number;
  fulfillmentNote?: string;
}

export class LeadbaseOrderError extends Error {}

// Website → LeadBase, tạo Order thật (system_design.md §4.1) — app tự gọi thẳng, không qua
// service trung gian nào. Ký HMAC bằng CÙNG secret site-engine dùng để verify chiều ngược lại
// (config.siteEngineSecret === Website.secret bên LeadBase, xem routes/public/productsSync.ts).
// "domain" gửi kèm để LeadBase biết tra Website nào ra đúng secret cần verify (LeadBase nhận đơn
// từ NHIỀU Website khác nhau, không như site-engine chỉ có 1 secret duy nhất của chính nó).
export async function sendOrderToLeadbase(
  input: SendOrderInput,
): Promise<{ orderCode: string }> {
  const body = JSON.stringify({
    sourceDomain: input.domain,
    customer: {
      name: input.customerName,
      phone: input.customerPhone,
      address: input.customerAddress ?? null,
      province: input.customerProvince ?? null,
    },
    items: input.items,
    total: input.total,
    shippingFee: input.shippingFee ?? 0,
    discount: input.discountAmount ?? 0,
    note: input.fulfillmentNote,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signSiteEngineRequest(config.siteEngineSecret, timestamp, body);

  const response = await fetch(`${config.leadbaseApiUrl}/api/site-engine/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-site-engine-signature-256": signature,
      "x-site-engine-timestamp": timestamp,
      "x-site-engine-domain": input.domain,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new LeadbaseOrderError(`LeadBase trả lỗi ${response.status}: ${text}`);
  }

  const json = (await response.json()) as { success?: boolean; orderCode?: string };
  if (!json.success || !json.orderCode) {
    throw new LeadbaseOrderError("LeadBase không trả về orderCode hợp lệ");
  }

  return { orderCode: json.orderCode };
}
