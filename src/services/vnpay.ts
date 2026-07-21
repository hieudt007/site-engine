import crypto from "node:crypto";
import type { VnpayConfig } from "./paymentMethods.js";

// Sandbox test: https://sandbox.vnpayment.vn/paymentv2/vpcpay.html (VNPay cap tmnCode/hashSecret
// rieng cho sandbox va production - tenant tu doi URL qua toggle "sandbox" trong config, KHONG
// phai 1 hang so global cho toan he thong nua, xem services/paymentMethods.ts).
const SANDBOX_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html";
const PROD_URL = "https://pay.vnpay.vn/vpcpay.html";

function formatVnpayDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// VNPay doi encode kieu application/x-www-form-urlencoded THAT (space -> "+", khong phai "%20")
// - encodeURIComponent chuan JS dung "%20", phai tu thay lai cho khop chu ky VNPay tinh phia ho.
function vnpayEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function sortedSignData(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((key) => `${vnpayEncode(key)}=${vnpayEncode(params[key])}`)
    .join("&");
}

export interface BuildVnpayUrlInput {
  config: VnpayConfig;
  orderId: string;
  amount: number; // VND, số nguyên
  ipAddr: string;
  returnUrl: string;
  orderInfo: string;
}

// vnp_TxnRef = chinh CartOrder.id - da unique san, khong can sinh ma rieng. IPN/return se dung
// truong nay de khop nguoc lai don hang (xem routes/public/vnpay.ts).
export function buildVnpayPaymentUrl(input: BuildVnpayUrlInput): string {
  const { config, orderId, amount, ipAddr, returnUrl, orderInfo } = input;
  if (!config.tmnCode || !config.hashSecret) {
    throw new Error("VNPay chưa được cấu hình đủ (thiếu mã TMN hoặc hash secret)");
  }

  const params: Record<string, string> = {
    vnp_Version: "2.1.0",
    vnp_Command: "pay",
    vnp_TmnCode: config.tmnCode,
    vnp_Amount: String(Math.round(amount) * 100),
    vnp_CurrCode: "VND",
    vnp_TxnRef: orderId,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: "other",
    vnp_Locale: "vn",
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: formatVnpayDate(new Date()),
  };

  const signData = sortedSignData(params);
  const secureHash = crypto.createHmac("sha512", config.hashSecret).update(signData).digest("hex");
  const baseUrl = config.sandbox === false ? PROD_URL : SANDBOX_URL;

  return `${baseUrl}?${signData}&vnp_SecureHash=${secureHash}`;
}

// Dung chung cho ca vnp_ReturnUrl (khach bi redirect trinh duyet ve) lan vnp_IpnUrl (VNPay goi
// server-to-server) - CA HAI deu phai verify chu ky truoc khi tin bat ky field nao trong query.
export function verifyVnpaySignature(query: Record<string, string>, hashSecret: string): boolean {
  const { vnp_SecureHash, ...rest } = query;
  delete (rest as Record<string, string>).vnp_SecureHashType;
  if (!vnp_SecureHash) {
    return false;
  }

  const signData = sortedSignData(rest as Record<string, string>);
  const expected = crypto.createHmac("sha512", hashSecret).update(signData).digest("hex");

  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(vnp_SecureHash.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
