import type { Agent } from "@prisma/client";

// Goi model tu 1 Agent (schema.prisma) da cau hinh san (provider/model/apiKey/baseUrl, nhap qua
// /admin/agents). Hau het provider dung chung API chat-completions kieu OpenAI (bao gom 9router
// "ai-router" — cung 1 VPS, goi qua localhost, xem CLAUDE.md cac du an anh em) — rieng "anthropic"
// dung API rieng (Messages API), xu ly tach nhanh.
const DEFAULT_BASE_URLS: Record<string, string> = {
  "openai": "https://api.openai.com/v1",
  "ai-router": "http://localhost:20128/v1",
  "deepseek": "https://api.deepseek.com/v1",
  "openrouter": "https://openrouter.ai/api/v1",
  "google": "https://generativelanguage.googleapis.com/v1beta/openai",
};

export class AiCallError extends Error {}

function resolveBaseUrl(agent: Agent): string {
  if (agent.baseUrl) return agent.baseUrl;
  const fallback = DEFAULT_BASE_URLS[agent.provider];
  if (!fallback) {
    throw new AiCallError(`Provider "${agent.provider}" cần baseUrl riêng, chưa cấu hình trong Agent`);
  }
  return fallback;
}

async function callAnthropic(agent: Agent, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": agent.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: agent.model,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    throw new AiCallError(`Anthropic API lỗi ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new AiCallError("Anthropic API trả về rỗng");
  }
  return text;
}

async function callOpenAiCompatible(agent: Agent, systemPrompt: string, userPrompt: string): Promise<string> {
  const baseUrl = resolveBaseUrl(agent).replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: agent.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    throw new AiCallError(`AI API lỗi ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new AiCallError("AI API trả về rỗng");
  }
  return text;
}

export async function callAgent(agent: Agent, systemPrompt: string, userPrompt: string): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }
  if (agent.provider === "anthropic") {
    return callAnthropic(agent, systemPrompt, userPrompt);
  }
  return callOpenAiCompatible(agent, systemPrompt, userPrompt);
}
