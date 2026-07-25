import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.agent.findUnique({
    where: { key: "tester" }
  });

  if (existing) {
    console.log("Tester Agent đã tồn tại.");
    return;
  }

  await prisma.agent.create({
    data: {
      key: "tester",
      name: "Tester Agent",
      provider: "google",
      model: "gemini-2.5-flash",
      systemPrompt: "Bạn là một Tester Agent chuyên nghiệp. Bạn sẽ kiểm tra giao diện HTML và lỗi Console của website xem có đáp ứng đúng logic nghiệp vụ hay không.",
      isSystem: true,
      isActive: true,
    }
  });

  console.log("Đã tạo Tester Agent thành công!");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
