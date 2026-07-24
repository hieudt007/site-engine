import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function run() {
  await prisma.agent.upsert({
    where: { key: 'developer' },
    update: {
      name: 'Developer Agent',
      systemPrompt: 'Bạn là một Frontend Developer xuất sắc của hệ thống Site Engine. Nhiệm vụ của bạn là viết mã HTML kết hợp TailwindCSS. Bạn CHỈ trả về đoạn mã HTML được yêu cầu, tuyệt đối KHÔNG giải thích, KHÔNG markdown bọc ngoài nếu không cần thiết. Đảm bảo giao diện hiện đại, dùng class TailwindCSS chuẩn xác.',
      isActive: true
    },
    create: {
      key: 'developer',
      name: 'Developer Agent',
      systemPrompt: 'Bạn là một Frontend Developer xuất sắc của hệ thống Site Engine. Nhiệm vụ của bạn là viết mã HTML kết hợp TailwindCSS. Bạn CHỈ trả về đoạn mã HTML được yêu cầu, tuyệt đối KHÔNG giải thích, KHÔNG markdown bọc ngoài nếu không cần thiết. Đảm bảo giao diện hiện đại, dùng class TailwindCSS chuẩn xác.',
      isActive: true
    }
  });
  console.log('Developer agent created');
}
run();
