import { prisma } from "../../db.js";
import { BaseAgent } from "./BaseAgent.js";

export class AgentFactory {
  static async create(agentType: string): Promise<BaseAgent | null> {
    // 1. Lấy thông tin model/provider từ Database
    // Ở site-engine, hiện tại có bảng Agent, ví dụ: name = agentType
    // Ta lấy agent theo tên hoặc alias. 
    // Tuy nhiên nếu DB chưa mapping rõ ràng, ta có thể fallback về default model.
    let agentModel = await prisma.agent.findFirst({
      where: { key: agentType, type: 'agent', isActive: true }
    });

    if (!agentModel) {
      // Fallback lấy agent admin default
      agentModel = await prisma.agent.findFirst();
      if (!agentModel) {
        throw new Error("Không tìm thấy Agent Model nào trong CSDL.");
      }
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
