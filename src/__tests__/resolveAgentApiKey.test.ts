import { describe, it, expect, vi } from "vitest";
import { encryptNodeString } from "../nodeCrypt.js";

// resolveAgentApiKey giai ma Agent.apiKey (hoac fallback SiteConfig.aiProviderKeys) - ca 2 deu
// luu duoi dang ma hoa tu sau khi vi lo hong "plaintext API key" duoc fix. Mock CacheService de
// khong can Redis/Postgres that.
vi.mock("../services/CacheService.js", () => ({
  CacheService: { getSiteConfig: vi.fn() },
}));

const { CacheService } = await import("../services/CacheService.js");
const { resolveAgentApiKey } = await import("../agents/core/aiClient.js");

function fakeAgent(overrides: Partial<{ apiKey: string | null; provider: string }> = {}) {
  return { apiKey: null, provider: "openai", ...overrides } as any;
}

describe("resolveAgentApiKey", () => {
  it("decrypts and returns the agent's own apiKey when set (no SiteConfig lookup needed)", async () => {
    const encrypted = encryptNodeString("sk-agent-own-key");
    const agent = fakeAgent({ apiKey: encrypted });

    const result = await resolveAgentApiKey(agent);

    expect(result).toBe("sk-agent-own-key");
    expect(CacheService.getSiteConfig).not.toHaveBeenCalled();
  });

  it("falls back to the decrypted provider key in SiteConfig when the agent has no key", async () => {
    const encrypted = encryptNodeString("sk-shared-provider-key");
    vi.mocked(CacheService.getSiteConfig).mockResolvedValue({ aiProviderKeys: { openai: encrypted } } as any);

    const result = await resolveAgentApiKey(fakeAgent({ apiKey: null, provider: "openai" }));

    expect(result).toBe("sk-shared-provider-key");
  });

  it("returns null when neither the agent nor SiteConfig has a key for the provider", async () => {
    vi.mocked(CacheService.getSiteConfig).mockResolvedValue({ aiProviderKeys: {} } as any);

    const result = await resolveAgentApiKey(fakeAgent({ apiKey: null, provider: "anthropic" }));

    expect(result).toBeNull();
  });

  it("returns null when SiteConfig itself doesn't exist yet", async () => {
    vi.mocked(CacheService.getSiteConfig).mockResolvedValue(null as any);

    const result = await resolveAgentApiKey(fakeAgent({ apiKey: null }));

    expect(result).toBeNull();
  });
});
