import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { requireRole } from "../../plugins/requireRole.js";

const menuItemSchema = z.object({
  label: z.string().min(1),
  url: z.string().min(1),
  sortOrder: z.number().default(0),
});

const putMenuSchema = z.object({
  name: z.string().min(1),
  items: z.array(menuItemSchema),
});

// Menu điều hướng public site — "slug" cố định theo vị trí trong theme ("header"/"footer", xem
// themes/default/layout.liquid). Không có màn "tạo Menu mới" — chỉ đúng các vị trí theme hỗ trợ,
// nên GET tự trả về menu rỗng nếu chưa từng lưu (chưa cần tồn tại row Menu), PUT tự upsert (tạo
// mới nếu đây là lần lưu đầu). Ghi đè TOÀN BỘ items mỗi lần lưu (xoá hết + tạo lại) - đơn giản
// hơn diff từng item, phù hợp menu ít mục (thường < 10).
export async function registerMenuRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { slug: string } }>(
    "/admin/api/menus/:slug",
    { preHandler: requireRole("manager") },
    async (request) => {
      const menu = await prisma.menu.findUnique({
        where: { slug: request.params.slug },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      return { menu: menu ?? { slug: request.params.slug, name: request.params.slug, items: [] } };
    },
  );

  app.put<{ Params: { slug: string } }>(
    "/admin/api/menus/:slug",
    { preHandler: requireRole("manager") },
    async (request, reply) => {
      const parsed = putMenuSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: parsed.error.flatten() });
      }

      const { slug } = request.params;
      const menu = await prisma.menu.upsert({
        where: { slug },
        create: { slug, name: parsed.data.name },
        update: { name: parsed.data.name },
      });

      await prisma.menuItem.deleteMany({ where: { menuId: menu.id } });
      if (parsed.data.items.length) {
        await prisma.menuItem.createMany({
          data: parsed.data.items.map((item) => ({ ...item, menuId: menu.id })),
        });
      }

      const updated = await prisma.menu.findUnique({
        where: { id: menu.id },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      return { menu: updated };
    },
  );
}
