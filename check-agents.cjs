const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.agent.findMany({
  where: { key: { in: ['content', 'search', 'chat', 'design', 'developer'] } },
  select: { key: true, name: true, isActive: true, systemPrompt: true }
}).then(agents => {
  agents.forEach(a => {
    console.log(`=== KEY: ${a.key} | ACTIVE: ${a.isActive} ===`);
    console.log((a.systemPrompt || '(empty)').slice(0, 500));
    console.log();
  });
}).finally(() => p.$disconnect());
