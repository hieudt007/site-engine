import { prisma } from "./db.js";

// Chay boi `npx prisma db seed` (package.json "prisma.seed") - goi 1 lan ngay sau
// `prisma migrate deploy` moi khi 1 site MOI duoc tao (xem scripts/site-engine-provision-app.sh
// action "migrate" ben lead-base). Idempotent (findFirst truoc khi create) - chay lai nhieu lan
// (vd script provision chay lai do loi giua chung) khong tao trung agent.
//
// apiKey de TRONG co chu dich - tenant tu vao /admin/agents nhap key that (hoac Setting dung
// chung ben lead-base neu sau nay lam tuong tu) truoc khi 2 tinh nang nay dung duoc, khong
// hardcode/seed san key that vao code.
const DEFAULT_MODEL = "cx/gpt-5.4-mini"; // model 9router re, du dung cho ca 2 muc dich mac dinh

const DEFAULT_AGENTS: { name: string; purpose: "content" | "design"; systemPrompt: string }[] = [
  {
    name: "Content Agent",
    purpose: "content",
    systemPrompt:
      "Bạn là trợ lý viết nội dung tiếng Việt cho blog/website bán hàng. Viết tự nhiên, đúng ngữ pháp, " +
      "không lan man, không bịa số liệu/cam kết cụ thể không được cung cấp.",
  },
  {
    name: "Developer Agent",
    purpose: "design",
    systemPrompt: "Bạn là chuyên gia thiết kế giao diện web, viết Liquid + Tailwind CSS.",
  },
];

async function main() {
  for (const def of DEFAULT_AGENTS) {
    const existing = await prisma.agent.findFirst({ where: { purpose: def.purpose } });
    if (existing) {
      console.log(`[seedAgents] Agent purpose="${def.purpose}" đã tồn tại (${existing.name}), bỏ qua.`);
      continue;
    }

    const agent = await prisma.agent.create({
      data: {
        name: def.name,
        provider: "ai-router",
        model: DEFAULT_MODEL,
        purpose: def.purpose,
        systemPrompt: def.systemPrompt,
        apiKey: null,
        baseUrl: null,
        isActive: true,
      },
    });
    console.log(`[seedAgents] Đã tạo agent "${agent.name}" (purpose=${def.purpose}).`);
  }
}

main()
  .catch((err) => {
    console.error("[seedAgents] Lỗi:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
