import { describe, it, expect } from "vitest";
import { injectSchemas, buildAnalyticsScripts } from "../services/themeRenderer.js";

// renderPublic() day du (doc file .liquid that + Redis) la moi quan tam rendering/UI, khong phai
// bao mat - bo qua o day. 2 ham thuan sau la phan CO gia tri bao mat: injectSchemas escape JSON-LD
// (chan XSS qua du lieu dong nhet vao <script>), buildAnalyticsScripts lap script GA/FB Pixel.
describe("injectSchemas", () => {
  it("inserts the JSON-LD script tag(s) right before </head>", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const result = injectSchemas(html, [{ "@type": "Organization", name: "Test" }]);
    expect(result).toContain('<script type="application/ld+json">');
    expect(result.indexOf("application/ld+json")).toBeLessThan(result.indexOf("</head>"));
  });

  it("appends at the end when there's no </head> tag at all", () => {
    const html = "<body>no head here</body>";
    const result = injectSchemas(html, [{ "@type": "Organization" }]);
    expect(result.endsWith("</script>")).toBe(true);
  });

  // Chan XSS: du lieu dua vao schema (vd site.siteName do admin nhap, hoac ten san pham) co the
  // chua "</script>" - neu khong escape ky tu "<" thi ke tan cong co the tu dong dong the script
  // som hon du dinh va chen HTML/JS tuy y ngay sau do.
  it("escapes '<' inside schema data so it cannot break out of the <script> tag", () => {
    const malicious = { "@type": "Organization", name: "</script><script>alert(1)</script>" };
    const result = injectSchemas("<head></head>", [malicious]);
    // Chi can escape "<" la du (browser doi dung chuoi "</script" de dong the, "\u003c" khong con
    // khop chuoi do nua) - "\u003e" cho ">" khong bat buoc va thuc te code khong lam vay.
    expect(result).not.toContain("</script><script>alert(1)</script>");
    expect(result).toContain("\\u003c/script>\\u003cscript>alert(1)\\u003c/script>");
  });

  it("joins multiple schemas as separate script tags", () => {
    const result = injectSchemas("<head></head>", [{ "@type": "A" }, { "@type": "B" }]);
    expect(result.match(/<script type="application\/ld\+json">/g)?.length).toBe(2);
  });
});

describe("buildAnalyticsScripts", () => {
  it("returns an empty string when no analytics fields are configured", () => {
    expect(buildAnalyticsScripts({})).toBe("");
  });

  it("includes the Google Analytics snippet only when gaId is set", () => {
    const result = buildAnalyticsScripts({ gaId: "G-TEST123" });
    expect(result).toContain("G-TEST123");
    expect(result).toContain("googletagmanager.com/gtag/js");
  });

  it("includes the Facebook Pixel snippet only when fbPixelId is set", () => {
    const result = buildAnalyticsScripts({ fbPixelId: "123456789" });
    expect(result).toContain("123456789");
    expect(result).toContain("fbevents.js");
  });

  it("includes the Google Search Console verification meta tag when set", () => {
    const result = buildAnalyticsScripts({ gscVerificationId: "verify-me" });
    expect(result).toContain('<meta name="google-site-verification" content="verify-me" />');
  });

  it("passes customHeadScript through verbatim (admin-trusted content)", () => {
    const result = buildAnalyticsScripts({ customHeadScript: "<script>console.log('custom')</script>" });
    expect(result).toContain("<script>console.log('custom')</script>");
  });

  it("combines all configured fields together", () => {
    const result = buildAnalyticsScripts({ gaId: "G-X", fbPixelId: "Y", gscVerificationId: "Z", customHeadScript: "<!-- custom -->" });
    expect(result).toContain("G-X");
    expect(result).toContain("Y");
    expect(result).toContain("Z");
    expect(result).toContain("<!-- custom -->");
  });
});
