import { describe, expect, it } from "vitest";
import { sanitizePostBody } from "./sanitizeHtml.js";

describe("sanitizePostBody", () => {
  it("strips <script> tags entirely", () => {
    const dirty = "<p>Hello</p><script>alert('xss')</script>";
    expect(sanitizePostBody(dirty)).toBe("<p>Hello</p>");
  });

  it("strips inline event handler attributes", () => {
    const dirty = '<img src="x.jpg" onerror="alert(1)">';
    const clean = sanitizePostBody(dirty);
    expect(clean).not.toContain("onerror");
    expect(clean).toContain('src="x.jpg"');
  });

  it("strips javascript: URLs from links", () => {
    const dirty = '<a href="javascript:alert(1)">click</a>';
    const clean = sanitizePostBody(dirty);
    expect(clean).not.toContain("javascript:");
  });

  it("keeps allowed formatting tags and attributes", () => {
    const clean = "<p>Xin chào <strong>thế giới</strong></p>";
    expect(sanitizePostBody(clean)).toBe(clean);
  });

  it("keeps safe http/https links and adds rel=noopener", () => {
    const dirty = '<a href="https://example.com">link</a>';
    const clean = sanitizePostBody(dirty);
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain("noopener");
  });

  it("strips disallowed tags like iframe/style but keeps their text content", () => {
    const dirty = "<p>Before</p><iframe src=\"evil\"></iframe><style>body{display:none}</style><p>After</p>";
    const clean = sanitizePostBody(dirty);
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<style");
    expect(clean).toContain("<p>Before</p>");
    expect(clean).toContain("<p>After</p>");
  });
});
