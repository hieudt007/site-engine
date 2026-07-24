import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";
import { generatePostContent, rewritePostContent } from "../../services/contentGenerator.js";

const generateSchema = z.object({ topic: z.string().min(1) });
const rewriteSchema = z.object({ body: z.string().min(1), instruction: z.string().min(1) });

// Agent dung cho tinh nang nay LUON la agent co purpose='content' - khong cho chon tay o day
// (khac trang tuy chinh theme, noi 1 site co the co nhieu theme dang lam song song nen can chon)
// vi day la 1 tinh nang don, chi can 1 agent dai dien roi. Neu tenant chua cau hinh (hoac xoa mat)
// thi bao loi ro rang thay vi 500 mo ho.
async function resolveContentAgent() {
  return prisma.agent.findFirst({ where: { key: "content", isActive: true } });
}

// Sinh/sua noi dung bai viet bang AI - KHONG tu luu, chi tra du lieu ve de admin xem/sua trong
// form truoc khi tu bam Luu that (giong het tinh than themeCustomize.ts: AI de xuat, con nguoi
// duyet). Dung chung logic voi post-edit.liquid, khong ap dung cho Page/Product o phien ban nay.
export async function registerPostsAiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/api/posts/ai-generate", { preHandler: requireRole("edit") }, async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const agent = await resolveContentAgent();
    if (!agent) {
      return reply.code(422).send({
        error: "Chưa có Agent nào cấu hình cho việc viết nội dung (Mục đích = Nội dung) — vào Quản trị → AI Agent.",
      });
    }

    try {
      const content = await generatePostContent(agent, parsed.data.topic);
      return { content };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/admin/api/posts/ai-rewrite", { preHandler: requireRole("edit") }, async (request, reply) => {
    const parsed = rewriteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: parsed.error.flatten() });
    }

    const agent = await resolveContentAgent();
    if (!agent) {
      return reply.code(422).send({
        error: "Chưa có Agent nào cấu hình cho việc viết nội dung (Mục đích = Nội dung) — vào Quản trị → AI Agent.",
      });
    }

    try {
      const body = await rewritePostContent(agent, parsed.data.body, parsed.data.instruction);
      return { body };
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });
}
