import { prisma } from "../../db.js";
import { BaseAgent } from "./BaseAgent.js";

export class AgentFactory {
  static async create(agentType: string): Promise<BaseAgent | null> {
    // Lay dung agent theo key - KHONG fallback ve "agent dau tien trong DB" nua (truoc day lam
    // vay, de lam agent SAI chay am tham ma khong ai biet neu agentType go/nhap sai). agentType
    // khong ton tai/khong active thi tra ve null, cho caller tu bao loi ro rang.
    const agentModel = await prisma.agent.findFirst({
      where: { key: agentType, type: 'agent', isActive: true }
    });
    if (!agentModel) {
      return null;
    }

    // 2. Resolve đúng Class Agent
    const { DeveloperAgent } = await import("../workers/DeveloperAgent.js");
    
    // Đảm bảo tools được nạp
    await import("../tools/index.js");

    switch (agentType) {
      case "developer":
        return new DeveloperAgent(agentModel);
      default:
        return new BaseAgent(agentModel);
    }
  }
}
