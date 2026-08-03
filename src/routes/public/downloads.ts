import fs from "node:fs";
import { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { resolveProductDownloadPath } from "../../services/mediaStorage.js";
import { renderNotFound } from "../../services/notFoundPage.js";

// Tai file san pham so cho khach hang SAU KHI da thanh toan - KHONG lo downloadFilePath (duong dan
// noi bo) ra HTML, chi redirect/stream qua day sau khi xac minh: don hang ton tai, da thanh toan
// xong (paymentStatus === 'paid' - dung nghia "thanh toan thanh cong" duy nhat co the xac thuc
// duoc trong he thong nay, xem docblock CartOrder.paymentStatus), va san pham nay THUC SU nam
// trong don hang do (chan doan link giua cac don/san pham khac nhau).
export async function registerDownloadRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { orderId: string; productId: string } }>(
    "/orders/:orderId/download/:productId",
    async (request, reply) => {
      const order = await prisma.cartOrder.findUnique({ where: { id: request.params.orderId } });
      if (!order) {
        return reply.code(404).type("text/html").send(await renderNotFound("Không tìm thấy đơn hàng"));
      }

      if (order.paymentStatus !== "paid") {
        return reply.code(403).type("text/html").send(await renderNotFound("Đơn hàng chưa thanh toán xong"));
      }

      const items = order.items as Array<{ leadbaseProductId?: string }>;
      const inOrder = items.some((item) => item.leadbaseProductId === request.params.productId);
      if (!inOrder) {
        return reply.code(403).type("text/html").send(await renderNotFound("Sản phẩm không thuộc đơn hàng này"));
      }

      const product = await prisma.productCache.findUnique({
        where: { leadbaseProductId: request.params.productId },
        select: { name: true, downloadFilePath: true },
      });
      if (!product?.downloadFilePath) {
        return reply.code(404).type("text/html").send(await renderNotFound("Sản phẩm này không có file tải về"));
      }

      const absolutePath = resolveProductDownloadPath(product.downloadFilePath);
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        return reply.code(404).type("text/html").send(await renderNotFound("File tải về không tồn tại"));
      }

      const ext = product.downloadFilePath.split(".").pop();
      const downloadName = ext ? `${product.name}.${ext}` : product.name;
      reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(downloadName)}"`);
      return reply.send(fs.createReadStream(absolutePath));
    },
  );
}
