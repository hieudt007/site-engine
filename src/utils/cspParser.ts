export function extractScriptDomains(html: string | null | undefined): string[] {
  if (!html) return [];
  
  const domains = new Set<string>();
  // Match both src="..." and src='...'
  const regex = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    try {
      const urlString = match[1];
      // Only extract domain if it's an absolute URL
      if (urlString.startsWith("http://") || urlString.startsWith("https://") || urlString.startsWith("//")) {
        const urlToParse = urlString.startsWith("//") ? `https:${urlString}` : urlString;
        const url = new URL(urlToParse);
        // Add protocol and host (e.g. "https://chat.zalo.me")
        domains.add(`${url.protocol}//${url.host}`);
      }
    } catch (_e) {
      // Ignore invalid URLs
    }
  }
  
  return Array.from(domains);
}
