import { prisma } from "../../db.js";
import { ToolRegistry } from "./ToolRegistry.js";

// Loai bo ten tool/skill "isSystem" khoi allowedTools/allowedSkills truoc khi ghi DB. Dung chung
// cho MOI noi tao/sua Agent (API cong khai /admin/api/agents VA code core tao agent tu khai bao
// manifest.json cua plugin trong routes/admin/plugins.ts) - ca 2 duong deu nhan mang string tuy
// y (tu request body hoac tu manifest do plugin tu viet), khong the chi dua vao UI an di tool
// isSystem, phai loc lai o day truoc khi ghi DB.
export async function stripSystemResources<T extends { allowedTools?: string[]; allowedSkills?: string[] }>(data: T): Promise<T> {
  const result = { ...data };
  if (result.allowedTools) {
    const systemToolNames = new Set(ToolRegistry.getAllTools().filter((t) => t.isSystem).map((t) => t.name));
    result.allowedTools = result.allowedTools.filter((name) => !systemToolNames.has(name));
  }
  if (result.allowedSkills && result.allowedSkills.length > 0) {
    const systemSkills = await prisma.agent.findMany({
      where: { type: "skill", isSystem: true, key: { in: result.allowedSkills } },
      select: { key: true },
    });
    const systemSkillKeys = new Set(systemSkills.map((s) => s.key));
    result.allowedSkills = result.allowedSkills.filter((key) => !systemSkillKeys.has(key));
  }
  return result;
}
