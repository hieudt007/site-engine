import dns from "node:dns";
import net from "node:net";

// Chan SSRF cho cac URL DO NGUOI DUNG NHAP (vd Agent.baseUrl nhap qua /admin/api/agents) - server se
// tu fetch() toi dung URL nay kem apiKey trong header. KHONG chan loopback/localhost - kien truc
// "ai-router" (xem DEFAULT_BASE_URLS trong aiClient.ts) CO CHU DICH goi qua localhost:20128 (cung 1
// VPS, service noi bo chinh chu), admin cung la nguoi DUY NHAT set duoc field nay (requireRole
// "admin" o routes/admin/agents.ts) nen loopback KHONG phai rui ro moi voi ho. Van chan cac dai that
// su nguy hiem: link-local/metadata endpoint cloud (169.254.x.x) va mang LAN noi bo (10.x/172.16.x/
// 192.168.x) - noi mot admin bi lua/session bi chiem co the dung server "do tham" sang may khac
// trong mang, hoac lay duoc IAM credentials cua chinh VPS qua metadata endpoint.

export class UnsafeOutboundUrlError extends Error {}

function ipv4ToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inIpv4Range(ip: string, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipv4ToLong(ip) & mask) === (ipv4ToLong(base) & mask);
}

// RFC 1918 (private) + RFC 3927 (link-local) + RFC 6598 (CGNAT) + multicast/reserved. KHONG gom
// loopback (127.0.0.0/8, ::1, "localhost") - xem giai thich o tren.
const PRIVATE_IPV4_RANGES: [string, number][] = [
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16], // link-local - bao gom ca 169.254.169.254 (cloud metadata endpoint).
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => inIpv4Range(ip, base, bits));
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 (link-local)
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 (unique local)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

function isUnsafeIp(ip: string): boolean {
  return net.isIPv6(ip) ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

// Throw UnsafeOutboundUrlError neu URL khong an toan de server tu goi toi. Phai await o CA hai noi:
// (1) luc luu cau hinh (bao loi som, UX tot) VA (2) luc THAT SU goi fetch() (phong DNS doi sau khi
// luu / TOCTOU) - xem routes/admin/agents.ts va agents/core/aiClient.ts.
export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError("URL không hợp lệ.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("Chỉ cho phép URL http/https.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return; // Loopback duoc phep co chu dich - xem ghi chu dau file.
  }

  if (net.isIP(hostname)) {
    if (isUnsafeIp(hostname)) {
      throw new UnsafeOutboundUrlError("Không được dùng URL trỏ tới IP nội bộ/riêng tư.");
    }
    return;
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeOutboundUrlError("Không phân giải được tên miền trong URL.");
  }
  if (addresses.length === 0 || addresses.some((a) => isUnsafeIp(a.address))) {
    throw new UnsafeOutboundUrlError("Tên miền trong URL trỏ tới IP nội bộ/riêng tư - bị chặn (chống SSRF).");
  }
}
