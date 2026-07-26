import { prisma } from "../src/db.js";

async function main() {
  console.log("Deleting plugin 'admin-ai-chat'...");
  await prisma.plugin.deleteMany({
    where: { slug: "admin-ai-chat" }
  });

  console.log("Attempting to drop table 'PluginAdminAiChatHistory'...");
  try {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "PluginAdminAiChatHistory" CASCADE;`);
    console.log("Dropped table successfully.");
  } catch (e) {
    console.log("Table might not exist, skipping drop.", e);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
