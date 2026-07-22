export interface UrlPrefixConfig {
  postSlugPrefix?: string | null;
  pageSlugPrefix?: string | null;
  productSlugPrefix?: string | null;
}

export function normalizeSlugPrefix(value: string | null | undefined, fallback: string): string {
  const raw = value ?? fallback;
  return raw.trim().replace(/^\/+|\/+$/g, "");
}

export function prefixPath(prefix: string): string {
  return prefix ? `/${prefix}` : "";
}

export function postPrefix(config: UrlPrefixConfig): string {
  return normalizeSlugPrefix(config.postSlugPrefix, "blog");
}

export function productPrefix(config: UrlPrefixConfig): string {
  return normalizeSlugPrefix(config.productSlugPrefix, "product");
}

export function pagePrefix(config: UrlPrefixConfig): string {
  return normalizeSlugPrefix(config.pageSlugPrefix, "p");
}

export function postPath(config: UrlPrefixConfig, slug: string): string {
  return `${prefixPath(postPrefix(config))}/${slug}`;
}

export function pagePath(config: UrlPrefixConfig, slug: string): string {
  return `${prefixPath(pagePrefix(config))}/${slug}`;
}

export function postCategoryPath(config: UrlPrefixConfig, slug: string): string {
  return `${prefixPath(postPrefix(config))}/danh-muc/${slug}`;
}

export function topicPath(config: UrlPrefixConfig, slug: string): string {
  return `${prefixPath(postPrefix(config))}/chu-de/${slug}`;
}

export function productPath(config: UrlPrefixConfig, id: string): string {
  return `${prefixPath(productPrefix(config))}/${id}`;
}

export function productCategoryPath(config: UrlPrefixConfig, slug: string): string {
  return `${prefixPath(productPrefix(config))}/danh-muc/${slug}`;
}

export function brandPath(config: UrlPrefixConfig, slug: string): string {
  return `${prefixPath(productPrefix(config))}/thuong-hieu/${slug}`;
}
