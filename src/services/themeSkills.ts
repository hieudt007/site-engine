import { prisma } from "../db.js";

export interface AgentSkill {
  slug: string;
  name: string;
  description: string;
}

// Skill = row Agent voi type='skill' (xem prisma/schema.prisma). "allowedKeys" la
// Agent.allowedSkills cua agent dang goi - RONG NGHIA LA KHONG DUOC DUNG SKILL NAO, giong
// quy uoc cua allowedTools (khong phai "khong gioi han").
export async function getAllAgentSkills(allowedKeys: string[] = []): Promise<AgentSkill[]> {
  if (allowedKeys.length === 0) return [];
  const skills = await prisma.agent.findMany({
    where: { type: "skill", isActive: true, key: { in: allowedKeys } },
    orderBy: { name: "asc" },
  });
  return skills
    .filter((s) => s.key)
    .map((s) => ({ slug: s.key as string, name: s.name, description: s.systemPrompt || "" }));
}

export async function getAgentSkillContent(slug: string): Promise<string | undefined> {
  const skill = await prisma.agent.findFirst({ where: { type: "skill", isActive: true, key: slug } });
  return skill?.content || undefined;
}
