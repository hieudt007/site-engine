import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const reviewer = await prisma.agent.upsert({
    where: { key: "reviewer" },
    update: {
      name: "Review Agent",
      provider: "google",
      model: "gemini-2.5-flash",
      isActive: true,
      isSystem: true,
    },
    create: {
      key: "reviewer",
      name: "Review Agent",
      provider: "google",
      model: "gemini-2.5-flash",
      isActive: true,
      isSystem: true,
    },
  });

  console.log("Upserted Review Agent:", reviewer);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
