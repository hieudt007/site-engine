import { describe, expect, it } from "vitest";
import { signSiteEngineRequest, verifySiteEngineRequest } from "./security.js";

const SECRET = "test-secret";

describe("signSiteEngineRequest / verifySiteEngineRequest", () => {
  it("verifies a request signed with the same secret", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ hello: "world" });
    const signature = signSiteEngineRequest(SECRET, timestamp, body);

    expect(verifySiteEngineRequest(SECRET, timestamp, body, signature)).toBe(true);
  });

  it("rejects a signature from a different secret", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ hello: "world" });
    const signature = signSiteEngineRequest("other-secret", timestamp, body);

    expect(verifySiteEngineRequest(SECRET, timestamp, body, signature)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSiteEngineRequest(SECRET, timestamp, JSON.stringify({ hello: "world" }));

    expect(
      verifySiteEngineRequest(SECRET, timestamp, JSON.stringify({ hello: "tampered" }), signature),
    ).toBe(false);
  });

  it("rejects a timestamp older than the 300s window", () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301);
    const body = JSON.stringify({ hello: "world" });
    const signature = signSiteEngineRequest(SECRET, staleTimestamp, body);

    expect(verifySiteEngineRequest(SECRET, staleTimestamp, body, signature)).toBe(false);
  });

  it("rejects a timestamp too far in the future", () => {
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 301);
    const body = JSON.stringify({ hello: "world" });
    const signature = signSiteEngineRequest(SECRET, futureTimestamp, body);

    expect(verifySiteEngineRequest(SECRET, futureTimestamp, body, signature)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const body = JSON.stringify({ hello: "world" });

    expect(verifySiteEngineRequest(SECRET, "not-a-number", body, "sha256=whatever")).toBe(false);
  });

  it("accepts a timestamp comfortably inside the 300s window", () => {
    const recentTimestamp = String(Math.floor(Date.now() / 1000) - 290);
    const body = JSON.stringify({ hello: "world" });
    const signature = signSiteEngineRequest(SECRET, recentTimestamp, body);

    expect(verifySiteEngineRequest(SECRET, recentTimestamp, body, signature)).toBe(true);
  });
});
