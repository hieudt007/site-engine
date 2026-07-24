import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { z } from "zod";

const formSubmissionSchema = z
  .object({
    formName: z.string().min(1),
    sourceUrl: z.string().optional(),
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    customerEmail: z.string().optional(),
    customerAddress: z.string().optional(),
    note: z.string().optional(),
  })
  .catchall(z.any()); // Bắt tất cả các trường còn lại (Ghi chú thêm, Tuổi, v.v...)

export async function registerFormsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/forms", async (request, reply) => {
    try {
      const parsed = formSubmissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const {
        formName,
        sourceUrl,
        customerName,
        customerPhone,
        customerEmail,
        customerAddress,
        note,
        ...payload // Các trường custom nằm hết ở đây
      } = parsed.data;

      const submission = await prisma.formSubmission.create({
        data: {
          formName,
          sourceUrl,
          customerName,
          customerPhone,
          customerEmail,
          customerAddress,
          note,
          payload,
        },
      });

      return reply.send({ success: true, submissionId: submission.id });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "Lỗi lưu form" });
    }
  });
}
