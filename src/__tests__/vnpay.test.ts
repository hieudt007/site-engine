import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildVnpayPaymentUrl, verifyVnpaySignature } from "../services/vnpay.js";
import type { VnpayConfig } from "../services/paymentMethods.js";

// Chu ky VNPay bao ve toan bo tien that (URL thanh toan + IPN xac nhan da tra tien) - sai o day
// dong nghia voi gia mao duoc trang thai thanh toan hoac URL redirect.
describe("buildVnpayPaymentUrl", () => {
  const config: VnpayConfig = { tmnCode: "TESTTMN", hashSecret: "test-hash-secret", sandbox: true };

  it("throws when tmnCode or hashSecret is missing", () => {
    expect(() => buildVnpayPaymentUrl({ config: {} as VnpayConfig, orderId: "1", amount: 100000, ipAddr: "1.2.3.4", returnUrl: "http://x", orderInfo: "x" })).toThrow();
  });

  it("builds a URL pointing to the sandbox host when sandbox is not explicitly false", () => {
    const url = buildVnpayPaymentUrl({ config, orderId: "order-1", amount: 100000, ipAddr: "1.2.3.4", returnUrl: "http://localhost/return", orderInfo: "Test order" });
    expect(url).toContain("sandbox.vnpayment.vn");
    expect(url).toContain("vnp_TxnRef=order-1");
  });

  it("builds a URL pointing to the production host when sandbox is false", () => {
    const url = buildVnpayPaymentUrl({ config: { ...config, sandbox: false }, orderId: "order-1", amount: 100000, ipAddr: "1.2.3.4", returnUrl: "http://localhost/return", orderInfo: "Test order" });
    expect(url).toContain("pay.vnpay.vn");
  });

  it("produces a URL with a secure hash that verifyVnpaySignature accepts", () => {
    const url = buildVnpayPaymentUrl({ config, orderId: "order-2", amount: 250000, ipAddr: "1.2.3.4", returnUrl: "http://localhost/return", orderInfo: "Don hang test" });
    const query = Object.fromEntries(new URL(url).searchParams.entries());
    expect(verifyVnpaySignature(query, config.hashSecret!)).toBe(true);
  });

  it("multiplies the VND amount by 100 (VNPay's smallest-unit convention)", () => {
    const url = buildVnpayPaymentUrl({ config, orderId: "order-3", amount: 100000, ipAddr: "1.2.3.4", returnUrl: "http://localhost/return", orderInfo: "x" });
    expect(url).toContain("vnp_Amount=10000000");
  });
});

describe("verifyVnpaySignature", () => {
  const hashSecret = "test-hash-secret";

  function sign(params: Record<string, string>): string {
    const signData = Object.keys(params).sort().map((k) => `${encodeURIComponent(k).replace(/%20/g, "+")}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`).join("&");
    return crypto.createHmac("sha512", hashSecret).update(signData).digest("hex");
  }

  it("accepts a correctly signed query", () => {
    const params = { vnp_TxnRef: "order-1", vnp_Amount: "10000000", vnp_ResponseCode: "00" };
    const query = { ...params, vnp_SecureHash: sign(params) };
    expect(verifyVnpaySignature(query, hashSecret)).toBe(true);
  });

  it("rejects when vnp_SecureHash is missing entirely", () => {
    expect(verifyVnpaySignature({ vnp_TxnRef: "order-1" }, hashSecret)).toBe(false);
  });

  // Chan gia mao: sua BAT KY field nao sau khi ky (vd doi ResponseCode tu that bai thanh "00"
  // thanh cong, hoac doi so tien) phai lam chu ky khong con khop.
  it("rejects when a signed field has been tampered with after signing", () => {
    const params = { vnp_TxnRef: "order-1", vnp_Amount: "10000000", vnp_ResponseCode: "01" };
    const signature = sign(params);
    const tamperedQuery = { ...params, vnp_ResponseCode: "00", vnp_SecureHash: signature };
    expect(verifyVnpaySignature(tamperedQuery, hashSecret)).toBe(false);
  });

  it("ignores vnp_SecureHashType when computing the signature (VNPay's own convention)", () => {
    const params = { vnp_TxnRef: "order-1", vnp_Amount: "10000000" };
    const query = { ...params, vnp_SecureHashType: "SHA512", vnp_SecureHash: sign(params) };
    expect(verifyVnpaySignature(query, hashSecret)).toBe(true);
  });

  it("rejects a signature produced with the wrong hashSecret", () => {
    const params = { vnp_TxnRef: "order-1", vnp_Amount: "10000000" };
    const query = { ...params, vnp_SecureHash: sign(params) };
    expect(verifyVnpaySignature(query, "wrong-secret")).toBe(false);
  });
});
