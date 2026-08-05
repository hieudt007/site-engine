// Xay JSON-LD (Schema.org) cho SEO - tra ve OBJECT thuong (khong phai chuoi), vi themeRenderer.ts
// la noi DUY NHAT stringify + escape "</script>" (tranh moi noi tu lam 1 kieu, de sot escape).
// Chu dich KHONG dua qua Liquid template - cu phap JSON viet bang Liquid rat de gay loi dau
// phay/escape, va viec nay khong lien quan gi den giao dien nen khong can AI/theme dung vao.

interface SiteInfo {
  siteName: string;
  logoUrl: string | null;
  domain: string;
}

export function absoluteUrl(domain: string, path: string): string {
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
  post: { title: string; excerpt: string | null; coverImage: string | null; publishedAt: Date | null; updatedAt?: Date },
  site: SiteInfo,
  postUrl: string,
  section?: string,
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
    // updatedAt luon co gia tri that (Prisma @updatedAt, tu dong set luc tao) nhung param de optional
    // vi 1 vai noi goi ham nay truyen "post" dang object rut gon (khong chon updatedAt trong select).
    ...(post.updatedAt ? { dateModified: post.updatedAt.toISOString() } : {}),
    ...(section ? { articleSection: section } : {}),
    publisher: {
      "@type": "Organization",
      name: site.siteName,
      ...(site.logoUrl ? { logo: { "@type": "ImageObject", url: absoluteUrl(site.domain, site.logoUrl) } } : {}),
    },
  };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Xay canonical/Open Graph/Twitter Card/article:* TRUC TIEP tu "schemas" (JSON-LD) da duoc tung
// route tinh san cho buildArticleSchema/buildProductSchema - CHINH cac object nay da "phan loai
// trang" roi (@type: "BlogPosting"/"Product"), khong can them 1 bo tham so rieng (ogType/ogImage/
// articlePublishedTime...) truyen song song qua tung route nhu buildAnalyticsScripts - vua trung
// lap du lieu, vua de quen khi them route moi. Goi TU themeRenderer.ts (giong dung cho
// injectSchemas/buildAnalyticsScripts), khong dua qua Liquid (ly do xem ghi chu dau file).
export interface MetaTagsSite {
  siteName: string;
  domain: string;
  defaultOgImage?: string | null;
  socialLinks?: { facebook?: string } | null;
}

export function buildMetaTags(
  schemas: Record<string, unknown>[],
  site: MetaTagsSite,
  pageTitle: string,
  metaDescription: string | undefined,
  canonicalUrl: string,
): string {
  const article = schemas.find((s) => s["@type"] === "BlogPosting") as Record<string, any> | undefined;
  const product = schemas.find((s) => s["@type"] === "Product") as Record<string, any> | undefined;

  const ogType = article ? "article" : product ? "product" : "website";
  const title = (article?.headline as string) || (product?.name as string) || pageTitle;
  const description = (article?.description as string) || metaDescription || "";
  const rawImage = (article?.image?.[0] as string) || (product?.image?.[0] as string) || site.defaultOgImage || undefined;
  const image = rawImage ? absoluteUrl(site.domain, rawImage) : undefined;
  const fbPage = site.socialLinks?.facebook;

  const tags: string[] = [
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`,
    `<meta property="og:locale" content="vi_VN">`,
    `<meta property="og:type" content="${ogType}">`,
    `<meta property="og:title" content="${escapeAttr(title)}">`,
  ];
  if (description) tags.push(`<meta property="og:description" content="${escapeAttr(description)}">`);
  tags.push(`<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`);
  tags.push(`<meta property="og:site_name" content="${escapeAttr(site.siteName)}">`);

  if (image) {
    tags.push(`<meta property="og:image" content="${escapeAttr(image)}">`);
    tags.push(`<meta property="og:image:secure_url" content="${escapeAttr(image)}">`);
  }

  if (article) {
    // Khong co truong rieng cho "trang Facebook cua tac gia bai viet" - dung chung
    // SiteConfig.socialLinks.facebook cho ca publisher/author, giong cach da so plugin SEO
    // WordPress fallback ve khi khong cau hinh rieng tung tac gia.
    if (fbPage) {
      tags.push(`<meta property="article:publisher" content="${escapeAttr(fbPage)}">`);
      tags.push(`<meta property="article:author" content="${escapeAttr(fbPage)}">`);
    }
    if (article.articleSection) tags.push(`<meta property="article:section" content="${escapeAttr(article.articleSection)}">`);
    if (article.datePublished) tags.push(`<meta property="article:published_time" content="${article.datePublished}">`);
    if (article.dateModified) tags.push(`<meta property="article:modified_time" content="${article.dateModified}">`);
  }

  tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  tags.push(`<meta name="twitter:title" content="${escapeAttr(title)}">`);
  if (description) tags.push(`<meta name="twitter:description" content="${escapeAttr(description)}">`);
  if (image) tags.push(`<meta name="twitter:image" content="${escapeAttr(image)}">`);

  return tags.join("\n");
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
