import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import TurndownService from "turndown";

const markdownCache = new Map<string, { hash: string; markdown: string; wordCount: number }>();

const converter = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

converter.remove(["script", "style", "header", "nav", "footer", "aside", "noscript", "svg"] as any);

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wantsMarkdown(request: FastifyRequest): boolean {
  return String(request.headers.accept || "")
    .toLowerCase()
    .split(",")
    .some((part) => part.trim().startsWith("text/markdown"));
}

function isPublicHtmlCandidate(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (!wantsMarkdown(request)) return false;

  const pathname = request.url.split("?")[0];
  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/assets") ||
    pathname.startsWith("/uploads") ||
    pathname.startsWith("/theme-assets") ||
    pathname.startsWith("/dev") ||
    pathname === "/health"
  ) {
    return false;
  }

  return true;
}

function appendVary(reply: FastifyReply, value: string): void {
  const current = reply.getHeader("vary");
  const values = Array.isArray(current) ? current.join(",") : String(current || "");
  const parts = values
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.some((part) => part.toLowerCase() === value.toLowerCase())) {
    parts.push(value);
  }
  reply.header("Vary", parts.join(", "));
}

function wordCount(markdown: string): number {
  return markdown.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

function payloadToHtml(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (Buffer.isBuffer(payload)) return payload.toString("utf-8");
  return null;
}

function absoluteRequestUrl(request: FastifyRequest): string {
  const proto = String(request.headers["x-forwarded-proto"] || request.protocol || "https").split(",")[0].trim();
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || request.hostname).split(",")[0].trim();
  return `${proto}://${host}${request.url}`;
}

function absolutize(value: string, baseUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(trimmed)) return value;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return value;
  }
}

function absolutizeHtmlUrls(html: string, baseUrl: string): string {
  return html.replace(/\b(href|src)=["']([^"']+)["']/gi, (_match, attr: string, value: string) => {
    return `${attr}="${absolutize(value, baseUrl)}"`;
  });
}

function extractReadableHtml(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1]) return main[1];
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article?.[1]) return article[1];
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (body?.[1]) return body[1];
  return html;
}

export function htmlToMarkdown(cacheId: string, html: string, baseUrl = "https://localhost/"): { markdown: string; contentHash: string; wordCount: number } {
  const normalizedHtml = absolutizeHtmlUrls(extractReadableHtml(html), baseUrl);
  const contentHash = hash(normalizedHtml);
  const cached = markdownCache.get(cacheId);
  if (cached?.hash === contentHash) {
    return { markdown: cached.markdown, contentHash, wordCount: cached.wordCount };
  }

  const markdown = normalizeMarkdown(converter.turndown(normalizedHtml));
  const count = wordCount(markdown);
  markdownCache.set(cacheId, { hash: contentHash, markdown, wordCount: count });
  return { markdown, contentHash, wordCount: count };
}

export function registerGeoMarkdownHook(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (!isPublicHtmlCandidate(request)) return payload;

    const contentType = String(reply.getHeader("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html")) return payload;

    const html = payloadToHtml(payload);
    if (!html || !/<html|<body|<main|<article|<section|<h1|<p[\s>]/i.test(html)) return payload;

    const { markdown, contentHash, wordCount: count } = htmlToMarkdown(request.url, html, absoluteRequestUrl(request));
    appendVary(reply, "Accept");
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    reply.header("ETag", `"geo-${contentHash.slice(0, 32)}"`);
    reply.header("X-Markdown-Generator", "Site Engine GEO");
    reply.header("X-Markdown-Word-Count", String(count));
    if (!reply.getHeader("cache-control")) {
      reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    }
    return markdown;
  });
}
