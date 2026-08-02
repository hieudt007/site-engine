import { describe, it, expect, vi, afterEach, afterAll } from "vitest";

// Bug that da gap: nhieu site-engine instance (moi website 1 tien trinh, xem lead-base-node's
// siteEngineProvision.ts) deu fallback ve CUNG 1 REDIS_URL mac dinh neu khong tu khai bao rieng,
// va truoc day CacheService dung tien to Redis CUNG MOT chuoi co dinh ('site_engine:') cho MOI
// instance - nen site A ghi cache se bi site B doc nham (hoac nguoc lai), rieng ve config/theme/
// menu/san pham/thanh toan. Test nay import lai module CacheService voi 2 gia tri
// SITE_ENGINE_INSTANCE_ID khac nhau (mo phong 2 instance that) va xac nhan chung khong con doc/
// ghi chung 1 key Redis nua. Can Redis THAT (giong quy uoc cac test khac dung CacheService).
describe("CacheService - per-instance cache isolation (multi site-engine on 1 VPS)", () => {
  const originalInstanceId = process.env.SITE_ENGINE_INSTANCE_ID;
  const testKey = `isolation_test_${Date.now()}`;

  async function importFreshCacheService(instanceId: string) {
    process.env.SITE_ENGINE_INSTANCE_ID = instanceId;
    vi.resetModules();
    return await import("../services/CacheService.js");
  }

  afterEach(() => {
    process.env.SITE_ENGINE_INSTANCE_ID = originalInstanceId;
  });

  afterAll(async () => {
    const { redis } = await importFreshCacheService("cleanup");
    await redis.del(
      `site_engine:site-a-${testKey}:${testKey}`,
      `site_engine:site-b-${testKey}:${testKey}`,
      `site_engine:site-a2-${testKey}:${testKey}_2`,
      `site_engine:site-b2-${testKey}:${testKey}_2`,
    );
    await redis.quit();
  });

  it("stores site A and site B's cached value under distinct Redis keys, not colliding", async () => {
    const siteAId = `site-a-${testKey}`;
    const siteBId = `site-b-${testKey}`;

    const { CacheService: CacheServiceA, redis: redisA } = await importFreshCacheService(siteAId);
    await CacheServiceA.remember(testKey, 60, async () => ({ owner: "site-a" }));

    const { CacheService: CacheServiceB, redis: redisB } = await importFreshCacheService(siteBId);
    await CacheServiceB.remember(testKey, 60, async () => ({ owner: "site-b" }));

    const rawA = await redisA.get(`site_engine:${siteAId}:${testKey}`);
    const rawB = await redisB.get(`site_engine:${siteBId}:${testKey}`);

    expect(JSON.parse(rawA!)).toEqual({ owner: "site-a" });
    expect(JSON.parse(rawB!)).toEqual({ owner: "site-b" });

    // Nếu vẫn dùng chung 1 tiền tố (bug cũ), site B's write sẽ nằm CÙNG 1 key với site A và
    // ghi đè giá trị của site A - xác nhận rõ ràng đây là 2 key Redis vật lý khác nhau.
    expect(`site_engine:${siteAId}:${testKey}`).not.toBe(`site_engine:${siteBId}:${testKey}`);

    await redisA.quit();
    await redisB.quit();
  });

  it("site A re-reading its own cache still gets its own value, unaffected by site B's write", async () => {
    const siteAId = `site-a2-${testKey}`;
    const siteBId = `site-b2-${testKey}`;

    const { CacheService: CacheServiceA } = await importFreshCacheService(siteAId);
    await CacheServiceA.remember(`${testKey}_2`, 60, async () => ({ owner: "site-a" }));

    const { CacheService: CacheServiceB } = await importFreshCacheService(siteBId);
    await CacheServiceB.remember(`${testKey}_2`, 60, async () => ({ owner: "site-b" }));

    // Re-import site A's own CacheService (fresh module instance, same instance id) and confirm
    // it still reads back ITS OWN cached value, not something clobbered by site B's write above.
    const { CacheService: CacheServiceAAgain, redis: redisAAgain } = await importFreshCacheService(siteAId);
    const resolverCalls: string[] = [];
    const result = await CacheServiceAAgain.remember(`${testKey}_2`, 60, async () => {
      resolverCalls.push("called");
      return { owner: "should-not-happen" };
    });

    expect(result).toEqual({ owner: "site-a" });
    expect(resolverCalls).toHaveLength(0); // cache hit, resolver never invoked

    await redisAAgain.quit();
  });
});
