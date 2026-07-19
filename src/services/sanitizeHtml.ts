import sanitizeHtml from "sanitize-html";

// Post.body được nhập bằng <textarea> HTML thô (editor rich-text thật vẫn TBD, task_list.md
// Phase 3) — PHẢI sanitize trước khi lưu, vì render lại nguyên văn (không escape) ở
// themes/*/blog-post.liquid. Không sanitize lúc render vì role "edit"/"manager" đều có thể sửa
// nội dung của người khác, sanitize ở input (lúc lưu) đảm bảo dữ liệu trong DB luôn sạch, không
// phụ thuộc theme nào render nó.
const ALLOWED_TAGS = [
  "p", "br", "hr", "strong", "em", "u", "s", "blockquote", "pre", "code",
  "h2", "h3", "h4", "ul", "ol", "li", "a", "img", "figure", "figcaption", "table", "thead",
  "tbody", "tr", "th", "td", "span", "div",
];

export function sanitizePostBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    },
  });
}
