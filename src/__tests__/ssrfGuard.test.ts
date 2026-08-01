import dns from "node:dns";
import { describe, it, expect, vi, afterEach } from "vitest";
import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from "../security/ssrfGuard.js";

// assertSafeOutboundUrl la tuyen phong thu CHINH chong SSRF cho Agent.baseUrl (nguoi dung tu nhap,
// server tu fetch() toi do kem apiKey that trong header) - sai o day = ke tan cong co the doc
// metadata endpoint cua cloud (169.254.169.254) hoac do tham mang LAN noi bo qua chinh server nay.
describe("assertSafeOutboundUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows loopback (localhost/127.0.0.1/::1) - dung cho kien truc ai-router noi bo", async () => {
    await expect(assertSafeOutboundUrl("http://localhost:20128/v1")).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl("http://127.0.0.1:3000")).resolves.toBeUndefined();
    await expect(assertSafeOutboundUrl("http://[::1]:3000")).resolves.toBeUndefined();
  });

  it("rejects a non-http(s) protocol", async () => {
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toThrow(UnsafeOutboundUrlError);
    await expect(assertSafeOutboundUrl("ftp://example.com")).rejects.toThrow(UnsafeOutboundUrlError);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertSafeOutboundUrl("not a url")).rejects.toThrow(UnsafeOutboundUrlError);
  });

  it("rejects the cloud metadata endpoint IP (169.254.169.254)", async () => {
    await expect(assertSafeOutboundUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(UnsafeOutboundUrlError);
  });

  it("rejects private IPv4 ranges (RFC 1918) given directly as the host", async () => {
    await expect(assertSafeOutboundUrl("http://10.0.0.5")).rejects.toThrow(UnsafeOutboundUrlError);
    await expect(assertSafeOutboundUrl("http://172.16.0.5")).rejects.toThrow(UnsafeOutboundUrlError);
    await expect(assertSafeOutboundUrl("http://192.168.1.5")).rejects.toThrow(UnsafeOutboundUrlError);
  });

  it("allows a direct public IPv4 address", async () => {
    await expect(assertSafeOutboundUrl("http://8.8.8.8")).resolves.toBeUndefined();
  });

  it("rejects a link-local IPv6 address", async () => {
    await expect(assertSafeOutboundUrl("http://[fe80::1]")).rejects.toThrow(UnsafeOutboundUrlError);
  });

  // TOCTOU/DNS rebinding: ten mien co ve hop le nhung phan giai ra IP noi bo - day chinh la trieu
  // chung DNS rebinding, phai chan dua tren KET QUA PHAN GIAI THAT, khong chi ten mien.
  it("rejects a hostname that resolves to a private IP (DNS rebinding)", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "192.168.1.1", family: 4 }] as any);
    await expect(assertSafeOutboundUrl("http://internal.example.com")).rejects.toThrow(UnsafeOutboundUrlError);
  });

  it("allows a hostname that resolves only to public IPs", async () => {
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "203.0.113.5", family: 4 }] as any);
    await expect(assertSafeOutboundUrl("http://public.example.com")).resolves.toBeUndefined();
  });

  it("rejects when DNS resolution fails entirely", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeOutboundUrl("http://does-not-exist.invalid")).rejects.toThrow(UnsafeOutboundUrlError);
  });
});
