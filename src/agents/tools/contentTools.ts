import { MCPTool } from "../core/ToolRegistry.js";
import { prisma } from "../../db.js";
import { slugify } from "../../services/slug.js";

export const getPostTool: MCPTool = {
  name: "get_post",
  description: "{\"id\": \"post_id\"}",
  execute: async (args, _context) => {
    const postId = args.id;
    if (!postId) return "Error: missing id.";
    return `Current content of post [${postId}]:\n<h1>Sample post</h1><p>This is the old content...</p>`;
  }
};

// Tool AN TOAN duy nhat de tao Post - LUON status="draft" (KHONG NHAN tham so status tu AI), khong
// co tool sua/xoa/publish di kem trong bo nay - danh rieng cho agent chay qua lich tu dong (vd
// "assistant" khi duoc goi lai boi services/automationScheduler.ts, khong ai giam sat, xem
// prisma/schema.prisma comment tren model Automation) can 1 hanh dong CHAC CHAN khong pha huy/khong
// tu cong khai noi dung. Muon sua/publish phai qua UI that, co nguoi duyet.
export const createDraftPostTool: MCPTool = {
  name: "create_draft_post",
  description:
    'Create a new blog post as a DRAFT (never published automatically - a human must review and publish manually). {"title": "...", "body": "HTML content", "excerpt": "optional short summary"}',
  execute: async (args, context) => {
    const title = String(args.title || "").trim();
    const body = String(args.body || "").trim();
    if (!title) return "Error: missing title.";
    if (!body) return "Error: missing body.";

    const base = slugify(title);
    let slug = base;
    for (let i = 1; i < 50; i++) {
      const existing = await prisma.post.findUnique({ where: { type_slug: { type: "post", slug } } });
      if (!existing) break;
      slug = `${base}-${i + 1}`;
    }

    const userId = context.meta?.userId ? Number(context.meta.userId) : null;
    const post = await prisma.post.create({
      data: {
        type: "post",
        title,
        slug,
        body,
        excerpt: String(args.excerpt || "").trim() || null,
        status: "draft",
        authorId: userId,
      },
    });
    return `Draft created: id=${post.id}, slug=${post.slug}. Status is "draft" - a human needs to review and publish it manually.`;
  },
};

