import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../../plugins/requireRole.js";
import { analyzeContentSeo, analyzeProductSeo } from "../../services/seoAnalyzer.js";

export async function registerAdminSeoRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/admin/api/seo/analyze",
    { preHandler: requireRole("edit") },
    async (request, reply) => {
      const schema = z.object({
        type: z.enum(["post", "page", "product"]),
        data: z.object({
          title: z.string().optional().default(""),
          name: z.string().optional().default(""),
          slug: z.string().optional().nullable(),
          body: z.string().optional().nullable(),
          description: z.string().optional().nullable(),
          excerpt: z.string().optional().nullable(),
          coverImage: z.string().optional().nullable(),
          keyword: z.string().optional(),
          metaTitle: z.string().optional(),
          metaDescription: z.string().optional(),
          ogImage: z.string().optional(),
          noindex: z.boolean().optional(),
          faq: z.any().optional(),
          specs: z.any().optional(), // Product only
          imageUrls: z.array(z.string()).optional(), // Product only
        }),
      });

      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Tham số không hợp lệ", details: parsed.error });
      }

      const { type, data } = parsed.data;

      const seoInput = {
        keyword: data.keyword,
        metaTitle: data.metaTitle,
        metaDescription: data.metaDescription,
        ogImage: data.ogImage,
        noindex: data.noindex,
      };

      let result;
      if (type === "product") {
        result = analyzeProductSeo({
          name: data.name || data.title,
          slug: data.slug,
          description: data.description || data.body,
          excerpt: data.excerpt,
          imageUrls: data.imageUrls || (data.coverImage ? [data.coverImage] : []),
          seo: seoInput,
          faq: data.faq,
          specs: data.specs,
        });
      } else {
        result = analyzeContentSeo({
          title: data.title,
          slug: data.slug,
          body: data.body,
          excerpt: data.excerpt,
          coverImage: data.coverImage,
          seo: seoInput,
          faq: data.faq,
        });
      }

      return reply.send({ result });
    }
  );
}
