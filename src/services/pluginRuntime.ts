import { z } from "zod";
import { prisma } from "../db.js";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export const READABLE_CORE_MODELS = [
  "SiteConfig",
  "Post",
  "Category",
  "Topic",
  "ProductCache",
  "ProductVariantCache",
  "CartOrder",
  "ProductReview",
  "Menu",
  "Media",
] as const;

const PUBLIC_CORE_MODELS = [
  "SiteConfig",
  "Post",
  "Category",
  "Topic",
  "ProductCache",
  "ProductReview",
  "Menu",
  "Media",
] as const;

const adminPageSchema = z.object({
  title: z.string().min(1).max(80),
  path: z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}$/),
  menuGroup: z.string().max(60).optional(),
  description: z.string().max(240).optional(),
});

const collectionSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,48}$/),
  label: z.string().min(1).max(80).optional(),
});

const publicDataSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/),
    source: z.enum(["collection", "coreModel"]),
    collection: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,48}$/).optional(),
    model: z.enum(PUBLIC_CORE_MODELS).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .superRefine((value, ctx) => {
    if (value.source === "collection" && !value.collection) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["collection"], message: "Collection is required." });
    }
    if (value.source === "coreModel" && !value.model) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Model is required." });
    }
  });

const publicFieldSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/),
  label: z.string().min(1).max(80).optional(),
  type: z.enum(["text", "email", "tel", "textarea", "number", "checkbox", "select"]).default("text"),
  required: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(2000).default(240),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
});

const publicActionSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/),
  collection: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,48}$/),
  enabled: z.boolean().default(true),
  submitLabel: z.string().min(1).max(60).optional(),
  successMessage: z.string().min(1).max(160).optional(),
  fields: z.array(publicFieldSchema).min(1).max(20),
});

const publicBlockSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/),
    title: z.string().min(1).max(120).optional(),
    placement: z
      .enum([
        "home_top",
        "home_after_products",
        "home_bottom",
        "blog_post_after_content",
        "page_after_content",
        "product_detail_after_content",
        "product_detail_sidebar",
        "layout_before_footer",
      ])
      .default("home_bottom"),
    dataKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/).optional(),
    actionKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,48}$/).optional(),
    variant: z.enum(["list", "grid", "strip", "json", "form"]).default("list"),
  })
  .superRefine((value, ctx) => {
    if (value.variant === "form" && !value.actionKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["actionKey"], message: "Action key is required." });
    }
    if (value.variant !== "form" && !value.dataKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dataKey"], message: "Data key is required." });
    }
  });

export const pluginManifestSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(SLUG_RE),
  version: z.string().min(1).max(40),
  description: z.string().max(500).optional(),
  adminPages: z.array(adminPageSchema).default([]),
  permissions: z
    .object({
      readModels: z.array(z.enum(READABLE_CORE_MODELS)).default([]),
    })
    .default({ readModels: [] }),
  collections: z.array(collectionSchema).default([]),
  publicData: z.array(publicDataSchema).default([]),
  publicBlocks: z.array(publicBlockSchema).default([]),
  publicActions: z.array(publicActionSchema).default([]),
});

export type ReadableCoreModel = (typeof READABLE_CORE_MODELS)[number];
type PublicCoreModel = (typeof PUBLIC_CORE_MODELS)[number];

export function manifestOf(plugin: { manifest: unknown }) {
  return pluginManifestSchema.parse(plugin.manifest);
}

export function assertCollectionAllowed(plugin: { manifest: unknown }, collection: string): boolean {
  const manifest = manifestOf(plugin);
  return manifest.collections.some((item) => item.name === collection);
}

export function publicActionOf(plugin: { manifest: unknown }, actionKey: string) {
  const manifest = manifestOf(plugin);
  const action = manifest.publicActions.find((item) => item.key === actionKey && item.enabled);
  if (!action) return null;
  const collectionAllowed = manifest.collections.some((item) => item.name === action.collection);
  if (!collectionAllowed) return null;
  return action;
}

export function validatePublicActionData(action: NonNullable<ReturnType<typeof publicActionOf>>, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, error: "Invalid payload." };
  }

  const input = body as Record<string, unknown>;
  if (typeof input.website !== "undefined" && String(input.website).trim()) {
    return { ok: false as const, error: "Invalid payload." };
  }

  const output: Record<string, string | number | boolean> = {};
  for (const field of action.fields) {
    const raw = input[field.name];
    const isEmpty = raw === undefined || raw === null || String(raw).trim() === "";
    if (field.required && isEmpty) {
      return { ok: false as const, error: `${field.name} is required.` };
    }
    if (isEmpty) continue;

    if (field.type === "checkbox") {
      output[field.name] = raw === true || raw === "true" || raw === "on" || raw === "1";
      continue;
    }

    if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { ok: false as const, error: `${field.name} must be a number.` };
      output[field.name] = value;
      continue;
    }

    const value = String(raw).trim();
    if (value.length > field.maxLength) {
      return { ok: false as const, error: `${field.name} is too long.` };
    }
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { ok: false as const, error: `${field.name} must be a valid email.` };
    }
    if (field.type === "select" && field.options?.length && !field.options.includes(value)) {
      return { ok: false as const, error: `${field.name} is invalid.` };
    }
    output[field.name] = value;
  }

  const allowedNames = new Set(action.fields.map((field) => field.name));
  for (const key of Object.keys(input)) {
    if (key !== "website" && !allowedNames.has(key)) {
      return { ok: false as const, error: `${key} is not allowed.` };
    }
  }

  return { ok: true as const, data: output };
}

export async function findEnabledPlugin(slug: string) {
  const plugin = await prisma.plugin.findUnique({ where: { slug } });
  if (!plugin || !plugin.enabled) return null;
  return plugin;
}

export async function readCoreModel(model: ReadableCoreModel, limit = 50) {
  const take = Math.max(1, Math.min(limit, 100));
  switch (model) {
    case "SiteConfig":
      return prisma.siteConfig.findMany({
        take: 1,
        select: { id: true, domain: true, siteName: true, tagline: true, siteType: true, contactEmail: true, contactPhone: true },
      });
    case "Post":
      return prisma.post.findMany({
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, type: true, title: true, slug: true, excerpt: true, status: true, publishedAt: true, updatedAt: true },
      });
    case "Category":
      return prisma.category.findMany({
        take,
        orderBy: { name: "asc" },
        select: { id: true, type: true, name: true, slug: true, parentId: true, excerpt: true, itemCount: true, updatedAt: true },
      });
    case "Topic":
      return prisma.topic.findMany({ take, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, createdAt: true } });
    case "ProductCache":
      return prisma.productCache.findMany({
        take,
        orderBy: { syncedAt: "desc" },
        select: { id: true, leadbaseProductId: true, name: true, slug: true, price: true, salePrice: true, status: true, stock: true, sku: true, syncedAt: true },
      });
    case "ProductVariantCache":
      return prisma.productVariantCache.findMany({
        take,
        orderBy: { syncedAt: "desc" },
        select: { id: true, productCacheId: true, leadbaseVariantId: true, sku: true, attributes: true, price: true, salePrice: true, stock: true },
      });
    case "CartOrder":
      return prisma.cartOrder.findMany({
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, customerName: true, customerPhone: true, total: true, paymentMethod: true, paymentStatus: true, createdAt: true },
      });
    case "ProductReview":
      return prisma.productReview.findMany({
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, productCacheId: true, customerName: true, rating: true, comment: true, status: true, createdAt: true },
      });
    case "Menu":
      return prisma.menu.findMany({ take: 20, orderBy: { slug: "asc" }, select: { id: true, slug: true, name: true, updatedAt: true } });
    case "Media":
      return prisma.media.findMany({
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, filename: true, url: true, mimeType: true, size: true, alt: true, createdAt: true },
      });
  }
}

async function readPublicCoreModel(model: PublicCoreModel, limit: number) {
  const take = Math.max(1, Math.min(limit, 100));
  switch (model) {
    case "SiteConfig":
      return prisma.siteConfig.findMany({
        take: 1,
        select: { domain: true, siteName: true, tagline: true, logoUrl: true, contactEmail: true, contactPhone: true },
      });
    case "Post":
      return prisma.post.findMany({
        where: { status: "published" },
        take,
        orderBy: { publishedAt: "desc" },
        select: { id: true, type: true, title: true, slug: true, excerpt: true, coverImage: true, publishedAt: true },
      });
    case "Category":
      return prisma.category.findMany({
        take,
        orderBy: { name: "asc" },
        select: { id: true, type: true, name: true, slug: true, parentId: true, excerpt: true, itemCount: true },
      });
    case "Topic":
      return prisma.topic.findMany({ take, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } });
    case "ProductCache":
      return prisma.productCache.findMany({
        where: { status: "published" },
        take,
        orderBy: { syncedAt: "desc" },
        select: { id: true, name: true, slug: true, excerpt: true, imageUrls: true, price: true, salePrice: true, stock: true, sku: true, avgRating: true, reviewCount: true },
      });
    case "ProductReview":
      return prisma.productReview.findMany({
        where: { status: "approved" },
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, productCacheId: true, customerName: true, rating: true, comment: true, createdAt: true },
      });
    case "Menu":
      return prisma.menu.findMany({ take: 20, orderBy: { slug: "asc" }, select: { id: true, slug: true, name: true, items: { orderBy: { sortOrder: "asc" } } } });
    case "Media":
      return prisma.media.findMany({
        take,
        orderBy: { createdAt: "desc" },
        select: { id: true, filename: true, url: true, mimeType: true, size: true, alt: true, createdAt: true },
      });
  }
}

function pluginDataKey(slug: string): string {
  return slug.replace(/-/g, "_");
}

export async function buildPublicPluginContext() {
  const plugins = await prisma.plugin.findMany({ where: { enabled: true }, orderBy: { name: "asc" } });
  const data: Record<string, Record<string, unknown>> = {};
  const areas: Record<string, unknown[]> = {};

  for (const plugin of plugins) {
    const manifest = pluginManifestSchema.safeParse(plugin.manifest);
    if (!manifest.success || (manifest.data.publicData.length === 0 && manifest.data.publicBlocks.length === 0)) continue;

    const pluginBucket: Record<string, unknown> = {
      slug: plugin.slug,
      name: plugin.name,
      version: plugin.version,
    };

    for (const source of manifest.data.publicData) {
      if (source.source === "collection" && source.collection) {
        const allowed = manifest.data.collections.some((collection) => collection.name === source.collection);
        if (!allowed) continue;
        pluginBucket[source.key] = await prisma.pluginRecord.findMany({
          where: { pluginSlug: plugin.slug, collection: source.collection },
          orderBy: { createdAt: "desc" },
          take: source.limit,
          select: { id: true, collection: true, data: true, createdAt: true, updatedAt: true },
        });
      }

      if (source.source === "coreModel" && source.model) {
        const allowed = manifest.data.permissions.readModels.includes(source.model);
        if (!allowed) continue;
        pluginBucket[source.key] = await readPublicCoreModel(source.model, source.limit);
      }
    }

    const bucketKey = pluginDataKey(plugin.slug);
    data[bucketKey] = pluginBucket;

    for (const block of manifest.data.publicBlocks) {
      const action = block.actionKey ? manifest.data.publicActions.find((item) => item.key === block.actionKey && item.enabled) : null;
      if (block.variant !== "form" && (!block.dataKey || !(block.dataKey in pluginBucket))) continue;
      if (block.variant === "form" && !action) continue;
      areas[block.placement] ??= [];
      areas[block.placement].push({
        key: block.key,
        title: block.title,
        pluginSlug: plugin.slug,
        pluginKey: bucketKey,
        pluginName: plugin.name,
        variant: block.variant,
        dataKey: block.dataKey,
        actionKey: block.actionKey,
        action,
        items: block.dataKey ? pluginBucket[block.dataKey] : [],
      });
    }
  }

  return { data, areas };
}

export async function buildPublicPluginData() {
  const context = await buildPublicPluginContext();
  return context.data;
}
