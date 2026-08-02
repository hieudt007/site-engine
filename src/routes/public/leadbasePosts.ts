import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { prisma } from "../../db.js";
import { verifySiteEngineRequest } from "../../security.js";
import { slugify } from "../../services/slug.js";
import { sanitizePostBody } from "../../services/sanitizeHtml.js";

const draftPostSchema = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1),
  excerpt: z.string().trim().max(500).optional().nullable(),
  leadbaseUserId: z.coerce.number().int().optional().nullable(),
});

function verifyLeadBaseRequest(request: any): boolean {
  const signature = request.headers["x-site-engine-signature-256"];
  const timestamp = request.headers["x-site-engine-timestamp"];
  return (
    typeof signature === "string" &&
    typeof timestamp === "string" &&
    typeof request.rawBody === "string" &&
    verifySiteEngineRequest(config.siteEngineSecret, timestamp, request.rawBody, signature)
  );
}

async function uniquePostSlug(title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  for (let i = 1; i < 50; i++) {
    const existing = await prisma.post.findUnique({ where: { type_slug: { type: "post", slug } } });
    if (!existing) return slug;
    slug = `${base}-${i + 1}`;
  }
  return `${base}-${Date.now()}`;
}

export async function registerLeadbasePostRoutes(app: FastifyInstance): Promise<void> {
  // Khop dung muc 60/phut dung cho /api/site-engine/orders ben lead-base-node.
  app.post("/api/leadbase/posts/draft", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!verifyLeadBaseRequest(request)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = draftPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const post = await prisma.post.create({
      data: {
        type: "post",
        title: parsed.data.title,
        slug: await uniquePostSlug(parsed.data.title),
        body: sanitizePostBody(parsed.data.body),
        excerpt: parsed.data.excerpt || null,
        status: "draft",
      },
    });

    return reply.code(201).send({
      success: true,
      post: {
        id: post.id,
        title: post.title,
        slug: post.slug,
        status: post.status,
        adminUrl: `/admin/posts/${post.id}`,
      },
    });
  });
}

