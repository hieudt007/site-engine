import cron from "node-cron";
import { prisma } from "../db.js";

// Tự chuyển status='scheduled' -> 'published' khi tới đúng giờ scheduledAt, set luôn publishedAt
// — nhờ vậy mọi nơi khác (route public, sitemap) chỉ cần lọc status='published', không phải tự
// tính "đã tới giờ chưa" ở từng chỗ. Quét mỗi phút là đủ, không cần chính xác tới giây cho CMS.
export function startPublishScheduler(): void {
  cron.schedule("* * * * *", () => {
    publishDueContent().catch((err) => console.error("publishScheduler: lỗi không mong đợi", err));
  });
}

export async function publishDueContent(): Promise<void> {
  const now = new Date();
  const where = { status: "scheduled", scheduledAt: { lte: now } };
  const data = { status: "published", publishedAt: now };

  // Post gộp cả 'post' và 'page' (phân biệt qua type) - 1 updateMany là đủ cho cả 2.
  await Promise.all([
    prisma.post.updateMany({ where, data }),
    prisma.productCache.updateMany({ where, data }),
  ]);
}
