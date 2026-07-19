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
