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

    // Dam bao tools duoc nap. Moi agent type deu dung chung BaseAgent - boi canh rieng (vd Theme/
    // Landing Page cho "developer") la trach nhiem cua CALLER qua AgentContext.extraSystemPrompt
    // (xem mcpChat.ts), khong con class con rieng nhu DeveloperAgent (da xoa).
    await import("../tools/index.js");
    return new BaseAgent(agentModel);
  }
}
