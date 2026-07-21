// Xay JSON-LD (Schema.org) cho SEO - tra ve OBJECT thuong (khong phai chuoi), vi themeRenderer.ts
// la noi DUY NHAT stringify + escape "</script>" (tranh moi noi tu lam 1 kieu, de sot escape).
// Chu dich KHONG dua qua Liquid template - cu phap JSON viet bang Liquid rat de gay loi dau
// phay/escape, va viec nay khong lien quan gi den giao dien nen khong can AI/theme dung vao.

interface SiteInfo {
  siteName: string;
  logoUrl: string | null;
  domain: string;
}

function absoluteUrl(domain: string, path: string): string {
  const base = domain.startsWith("http") ? domain : `https://${domain}`;
  return new URL(path, base).toString();
}

export function buildOrganizationSchema(site: SiteInfo): Record<string, unknown> {
  const url = absoluteUrl(site.domain, "/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": url + "#organization",
        name: site.siteName,
        url,
        ...(site.logoUrl ? { logo: absoluteUrl(site.domain, site.logoUrl) } : {}),
      },
      {
        "@type": "WebSite",
        "@id": url + "#website",
        name: site.siteName,
        url,
        publisher: { "@id": url + "#organization" },
      },
    ],
  };
}

export function buildProductSchema(
  product: { name: string; imageUrls: string[]; price: unknown; salePrice: unknown; stock: number | null },
  productUrl: string,
  reviews: { rating: number }[],
): Record<string, unknown> {
  const price = product.salePrice ?? product.price;
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: product.imageUrls,
    url: productUrl,
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: "VND",
      price: Number(price),
      availability: product.stock === null || product.stock === undefined || product.stock > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
    },
  };
  if (reviews.length) {
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(avg * 10) / 10,
      reviewCount: reviews.length,
    };
  }
  return schema;
}

export function buildArticleSchema(
  post: { title: string; excerpt: string | null; coverImage: string | null; publishedAt: Date | null },
  site: SiteInfo,
  postUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    url: postUrl,
    mainEntityOfPage: postUrl,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(post.coverImage ? { image: [post.coverImage] } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt.toISOString() } : {}),
    publisher: {
      "@type": "Organization",
      name: site.siteName,
      ...(site.logoUrl ? { logo: { "@type": "ImageObject", url: absoluteUrl(site.domain, site.logoUrl) } } : {}),
    },
  };
}

export function buildBreadcrumbSchema(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
