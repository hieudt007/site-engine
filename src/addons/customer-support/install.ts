import { getPluginDb } from "../../services/pluginDb.js";

// Agent CSKH KHONG con tao o day nua - da chuyen thanh khai bao trong manifest.json
// (permissions.ai.agents), duoc CORE (routes/admin/plugins.ts) tu tao bang prisma that (Agent la
// bang core, getPluginDb() chan ORM ghi bang nay - "seeder" tao Agent BAT BUOC phai la code core,
// khong the la code cua plugin dua vao day). install.ts o day chi con lo dung phan viec cua no:
// tao bang dong cua chinh plugin (da khai bao trong manifest.tables). Tool cua plugin duoc dang ky
// o backend/index.ts (module-level, chay moi lan server start cho plugin dang bat).
export async function setup(prisma: ReturnType<typeof getPluginDb>, pluginSlug: string) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PluginCustomerSupportChat" (
      "id" SERIAL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "agentKey" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "images" JSONB,
      "url" TEXT,
      "title" TEXT,
      "productId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PluginCustomerSupportChat_sessionId_idx" ON "PluginCustomerSupportChat"("sessionId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PluginCustomerSupportLead" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT,
      "phone" TEXT NOT NULL,
      "notes" TEXT,
      "sessionId" TEXT,
      "url" TEXT,
      "status" TEXT NOT NULL DEFAULT 'new',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log(`[Plugin: ${pluginSlug}] Đã tạo bảng PluginCustomerSupportChat và PluginCustomerSupportLead thành công.`);
}
