import { describe, it, expect } from "vitest";
import { encryptNodeString, decryptNodeString } from "../nodeCrypt.js";

// Ma hoa Agent.apiKey/SiteConfig.aiProviderKeys tai DB - sai o day dong nghia voi lo API key AI
// provider that (OpenAI/Anthropic...) cua khach hang plaintext trong DB. NODE_ENCRYPTION_KEY luon
// duoc set trong vitest.config/CI ve gia tri throwaway 32 byte cho test.
describe("nodeCrypt", () => {
  it("round-trips a plaintext string through encrypt/decrypt", () => {
    const plain = "sk-real-api-key-1234567890abcdef";
    const encrypted = encryptNodeString(plain);
    expect(encrypted).not.toBe(plain);
    expect(decryptNodeString(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV) for the same plaintext", () => {
    const plain = "same-key-twice";
    const a = encryptNodeString(plain);
    const b = encryptNodeString(plain);
    expect(a).not.toBe(b);
    expect(decryptNodeString(a)).toBe(plain);
    expect(decryptNodeString(b)).toBe(plain);
  });

  it("throws when decrypting a value that isn't valid ciphertext (e.g. still-plaintext data)", () => {
    expect(() => decryptNodeString("this-is-just-plaintext-not-encrypted")).toThrow();
  });

  it("throws when the ciphertext has been tampered with (GCM auth tag mismatch)", () => {
    const encrypted = encryptNodeString("some secret");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[bytes.length - 1] ^= 0xff; // lat 1 bit cuoi cung cua ciphertext
    const tampered = bytes.toString("base64");
    expect(() => decryptNodeString(tampered)).toThrow();
  });
});
