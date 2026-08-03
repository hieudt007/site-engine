import { Redis } from 'ioredis';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

// Giong pattern DISABLE_QUEUE cua lead-base-node/src/redis.ts - moi truong local KHONG co
// Redis chay co the tat han ket noi that (tranh ioredis retry toi 20 lan/request roi moi bo
// cuoc, khien MOI request luu bai viet/san pham/danh muc bi treo rat lau du van thanh cong -
// bug thuc te da gap). CHI dung DISABLE_QUEUE, KHONG check NODE_ENV==='test' nhu lead-base-node
// - CI cua site-engine (.github/workflows) chay Redis that (service container) + NODE_ENV=test
// cung luc, vd cacheServiceInstanceIsolation.test.ts can Redis THAT de kiem tra cache isolation
// giua cac instance - mock se lam sai lech ket qua test do (da gap: assertion fail that su).
const isDisabled = process.env.DISABLE_QUEUE === 'true';

function createMockRedis(): Redis {
  return {
    on: () => {},
    once: () => {},
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    scan: async () => ['0', []],
    quit: async () => 'OK',
    disconnect: () => {},
  } as unknown as Redis;
}

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
export const redis = isDisabled
  ? createMockRedis()
  : new Redis(redisUrl, {
      lazyConnect: true,
    });

if (!isDisabled) {
  redis.on('error', (err: any) => {
    logger.error(err, '[Redis] Connection error');
  });
}

// Use a specific prefix to avoid colliding with lead-base-node, PLUS the per-instance id so
// multiple site-engine instances sharing this same Redis (all fall back to the same REDIS_URL
// unless customized, see siteEngineProvision.ts) don't read/write each other's cached
// site_config/theme_config/menus/etc.
const PREFIX = `site_engine:${config.siteEngineInstanceId}:`;
const DEFAULT_TTL = 86400; // 24 hours (1 day)

export class CacheService {
  /**
   * Get value from cache, or resolve it and store if missing.
   */
  static async remember<T>(key: string, ttlSeconds: number, resolver: () => Promise<T>): Promise<T> {
    const fullKey = PREFIX + key;
    try {
      const cached = await redis.get(fullKey);
      if (cached) {
        return JSON.parse(cached, (k, v) => {
          // Prisma handles Decimals, Site Engine uses Decimal for price, total, etc.
          // Since it's JSON stringified, Decimals become strings. 
          // If we need them as Decimals, we might need to parse them, but for config it's fine.
          return v;
        }) as T;
      }
    } catch (e) {
      logger.error(e, `[Redis] Error getting key ${fullKey}`);
    }

    const value = await resolver();

    try {
      if (value !== undefined && value !== null) {
        await redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
      }
    } catch (e) {
      logger.error(e, `[Redis] Error setting key ${fullKey}`);
    }

    return value;
  }

  /**
   * Invalidate a single key.
   */
  static async forget(key: string): Promise<void> {
    try {
      await redis.del(PREFIX + key);
    } catch (e) {
      logger.error(e, `[Redis] Error deleting key ${PREFIX + key}`);
    }
  }

  /**
   * Invalidate keys matching a pattern.
   * e.g. CacheService.forgetPattern('redirect:*')
   */
  static async forgetPattern(pattern: string): Promise<void> {
    try {
      const fullPattern = PREFIX + pattern;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (e) {
      logger.error(e, `[Redis] Error deleting pattern ${PREFIX + pattern}`);
    }
  }

  // ==========================================
  // CONFIGURATION & DICTIONARIES
  // ==========================================

  static async getSiteConfig() {
    return this.remember('global:site_config', DEFAULT_TTL, async () => {
      let config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
      if (!config) {
        config = await prisma.siteConfig.create({
          data: { id: "singleton", domain: "localhost", siteName: "Site Engine" }
        });
      }
      return config;
    });
  }

  static async getThemeConfig() {
    return this.remember('global:theme_config', DEFAULT_TTL, async () => {
      let config = await prisma.themeConfig.findUnique({ where: { id: "singleton" } });
      if (!config) {
        config = await prisma.themeConfig.create({
          data: { id: "singleton", activeTheme: "default" }
        });
      }
      return config;
    });
  }

  static async getMenus() {
    return this.remember('global:menus', DEFAULT_TTL, async () => {
      return prisma.menu.findMany({
        include: { items: { orderBy: { sortOrder: 'asc' } } }
      });
    });
  }

  static async getAgents() {
    return this.remember('global:agents', DEFAULT_TTL, async () => {
      return prisma.agent.findMany();
    });
  }

  static async getRedirect(fromPath: string) {
    return this.remember(`redirect:${fromPath}`, DEFAULT_TTL, async () => {
      return prisma.redirect.findUnique({ where: { fromPath } });
    });
  }

  // E-commerce Settings
  static async getPaymentMethods() {
    return this.remember('global:payment_methods', DEFAULT_TTL, async () => {
      return prisma.paymentMethod.findMany();
    });
  }

  static async getShippingRules() {
    return this.remember('global:shipping_rules', DEFAULT_TTL, async () => {
      return prisma.shippingRule.findMany();
    });
  }

  static async getFulfillmentMethods() {
    return this.remember('global:fulfillment_methods', DEFAULT_TTL, async () => {
      return prisma.fulfillmentMethod.findMany();
    });
  }

  static async getStores() {
    return this.remember('global:stores', DEFAULT_TTL, async () => {
      return prisma.store.findMany();
    });
  }

  static async getCoupons() {
    return this.remember('global:coupons', DEFAULT_TTL, async () => {
      return prisma.coupon.findMany();
    });
  }

  static async getCategories() {
    return this.remember('global:categories', DEFAULT_TTL, async () => {
      return prisma.category.findMany({
        include: { children: { select: { name: true, slug: true } } }
      });
    });
  }

  // ==========================================
  // PAGES, POSTS, & PRODUCTS (On-Demand Cache)
  // ==========================================

  static async getPageBySlug(slug: string) {
    return this.remember(`page:${slug}`, DEFAULT_TTL, async () => {
      return prisma.post.findUnique({ where: { type_slug: { type: "page", slug } } });
    });
  }

  static async getPostBySlug(slug: string) {
    return this.remember(`post:${slug}`, DEFAULT_TTL, async () => {
      return prisma.post.findUnique({
        where: { type_slug: { type: "post", slug } },
        include: { categories: { select: { name: true, slug: true } } },
      });
    });
  }

  static async getProductByIdOrSlug(idOrSlug: string) {
    return this.remember(`product:${idOrSlug}`, DEFAULT_TTL, async () => {
      const product =
        (await prisma.productCache.findUnique({
          where: { slug: idOrSlug } as any,
          include: { variants: true, categories: { select: { name: true, slug: true } } },
        })) ??
        (await prisma.productCache.findUnique({
          where: { id: idOrSlug },
          include: { variants: true, categories: { select: { name: true, slug: true } } },
        }));
      return product;
    });
  }

  // ==========================================
  // CONTENT LIST CACHE (Lists and Pagination)
  // ==========================================

  static async getLatestPosts(limit: number) {
    return this.remember('home:posts', DEFAULT_TTL, async () => {
      return prisma.post.findMany({
        where: { type: "post", status: "published" },
        orderBy: { publishedAt: "desc" },
        take: limit,
        select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true },
      });
    });
  }

  static async getLatestProducts(limit: number) {
    return this.remember('home:products', DEFAULT_TTL, async () => {
      return prisma.productCache.findMany({
        where: { status: "published" },
        orderBy: { syncedAt: "desc" },
        take: limit,
        select: { id: true, slug: true, name: true, imageUrls: true, price: true, salePrice: true } as any,
      });
    });
  }

  static async getProductList(queryHash: string, queryFn: () => Promise<any>) {
    return this.remember(`product_list:${queryHash}`, DEFAULT_TTL, queryFn);
  }

  static async getPostList(queryHash: string, queryFn: () => Promise<any>) {
    return this.remember(`blog_list:${queryHash}`, DEFAULT_TTL, queryFn);
  }
}
