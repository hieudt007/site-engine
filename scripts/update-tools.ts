import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function run() {
  const updated = await prisma.agent.updateMany({
    where: {
      OR: [
        { key: "websearch" },
        { key: "webfetch" },
        { key: "generate_image" },
        { endpoint: "/search" },
        { endpoint: "/web/fetch" },
        { endpoint: "/images/generations" },
      ]
    },
    data: {
      type: "tool"
    }
  });
  console.log(`Updated ${updated.count} agents to type "tool".`);
}
run().finally(() => prisma.$disconnect());
