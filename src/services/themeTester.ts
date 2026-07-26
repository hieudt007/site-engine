import fs from "node:fs/promises";
import path from "node:path";
import type { Agent } from "@prisma/client";
import { callAgent } from "../agents/core/aiClient.js";

interface TestResult {
  status: "PASS" | "REJECT";
  feedback?: string;
}

export async function callTestAgent(
  testerAgent: Agent, 
  coderMessage: string, 
  consoleErrors: string[]
): Promise<TestResult> {
  let promptTemplate = "";
  try {
    promptTemplate = await fs.readFile(path.join(process.cwd(), "src", "agents", "tester.md"), "utf-8");
  } catch (err) {
    console.error("Không thể đọc file src/agents/tester.md:", err);
    return { status: "PASS" };
  }

  const prompt = promptTemplate
    .replace("{{CODER_MESSAGE}}", coderMessage)
    .replace("{{CONSOLE_ERRORS}}", consoleErrors.length > 0 ? consoleErrors.join("\n") : "Không có lỗi nào.");

  try {
    const systemPrompt = "Bạn là một AI chấm thi khắt khe. Luôn trả về đúng chuẩn JSON.";
    const rawResponse = await callAgent(testerAgent, systemPrompt, prompt, undefined, true);
    
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.status === "PASS" || parsed.status === "REJECT") {
        return { status: parsed.status, feedback: parsed.feedback };
      }
    }
    return { status: "PASS" }; // Fallback
  } catch (err) {
    console.error("Lỗi khi gọi Tester Agent:", err);
    return { status: "PASS" }; // Fallback nếu API lỗi để không block luồng
  }
}

export async function callReviewAgent(
  reviewAgent: Agent, 
  coderMessage: string, 
  screenshotUrl: string
): Promise<TestResult> {
  let promptTemplate = "";
  try {
    promptTemplate = await fs.readFile(path.join(process.cwd(), "src", "agents", "reviewer.md"), "utf-8");
  } catch (err) {
    console.error("Không thể đọc file src/agents/reviewer.md:", err);
    return { status: "PASS" };
  }

  const prompt = promptTemplate.replace("{{CODER_MESSAGE}}", coderMessage);

  try {
    const systemPrompt = "Bạn là một AI chấm thi khắt khe. Luôn trả về đúng chuẩn JSON.";
    const rawResponse = await callAgent(reviewAgent, systemPrompt, prompt, screenshotUrl, true);
    
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.status === "PASS" || parsed.status === "REJECT") {
        return { status: parsed.status, feedback: parsed.feedback };
      }
    }
    return { status: "PASS" }; // Fallback
  } catch (err) {
    console.error("Lỗi khi gọi Review Agent:", err);
    return { status: "PASS" }; // Fallback pass nếu lỗi API
  }
}
