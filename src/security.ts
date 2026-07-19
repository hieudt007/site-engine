import crypto from "node:crypto";

const SIGNATURE_WINDOW_SECONDS = 300;

function hmacSha256(secret: string, payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signSiteEngineRequest(secret: string, timestamp: string, body: string): string {
  return hmacSha256(secret, `${timestamp}.${body}`);
}

export function verifySiteEngineRequest(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return false;
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - ts);
  if (ageSeconds > SIGNATURE_WINDOW_SECONDS) {
    return false;
  }

  return safeEquals(signSiteEngineRequest(secret, timestamp, body), signature);
}

export interface SsoTokenPayload {
  userId: number;
  userName: string;
  permissions: string[];
  exp: number; // unix seconds
}

// Token bàn giao định danh (system_design.md §5.1) — KHÔNG phải request signing (§4), payload
// tự mang exp riêng thay vì dùng timestamp window cố định. Format: base64url(json).hexsig
export function signSsoToken(secret: string, payload: SsoTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${signature}`;
}

export function verifySsoToken(secret: string, token: string): SsoTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encoded, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  if (!safeEquals(expected, signature)) {
    return null;
  }

  let payload: SsoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload.userId !== "number" ||
    typeof payload.userName !== "string" ||
    !Array.isArray(payload.permissions) ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  if (Date.now() / 1000 > payload.exp) {
    return null;
  }

  return payload;
}
