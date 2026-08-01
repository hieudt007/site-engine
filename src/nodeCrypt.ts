import crypto from "node:crypto";

// AES-256-GCM (GCM tich hop san Auth Tag, khong can tu tinh HMAC rieng) - dung cho du lieu sieu
// nhay cam luu tai DB (Agent.apiKey, SiteConfig.aiProviderKeys). Cung dinh dang voi
// lead-base-node/src/nodeCrypt.ts de nhat quan giua cac repo "anh em".
const KEY = (() => {
  const raw = process.env.NODE_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "test") {
      return Buffer.alloc(32, "test");
    }
    throw new Error("Thieu bien moi truong NODE_ENCRYPTION_KEY (32 byte, dang base64).");
  }
  const buf = Buffer.from(raw.replace(/^base64:/, ""), "base64");
  if (buf.length !== 32) {
    throw new Error("NODE_ENCRYPTION_KEY phai la 32 byte sau khi decode base64 (dung cho AES-256).");
  }
  return buf;
})();

const IV_LENGTH = 12; // Khuyen nghi cho GCM (96-bit)

// Format luu: base64(iv(12 byte) + authTag(16 byte) + ciphertext).
export function encryptNodeString(plain: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptNodeString(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf-8");
}
