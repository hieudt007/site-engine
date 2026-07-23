import fs from "node:fs";
import path from "node:path";
import type { Agent } from "@prisma/client";
import { prisma } from "../db.js";

// Ghi lai context gui/nhan voi AI de debug - GHI DE (khong noi tiep) - chi giu LAN GOI GAN NHAT,
// tranh file phinh to vo han qua nhieu luot chat (1 luot co the goi AI nhieu lan: phan loai + tung
// nhom + retry, nhung debug chi can xem duoc lan cuoi de kiem tra, khong can lich su day du). Ghi
// vao debug-ai/ (KHONG phai uploads/ - uploads/ dang serve tinh cong khai qua /uploads/, ghi prompt
// that vao do se lo noi dung theme + du lieu ra ngoai cho bat ky ai biet duong dan).
const DEBUG_DIR = path.join(process.cwd(), "debug-ai");

function writeDebugLog(kind: "input" | "output", agent: Agent, content: string): void {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    const entry = `===== ${stamp} | agent=${agent.name} (${agent.provider}/${agent.model}) =====\n${content}\n`;
    fs.writeFileSync(path.join(DEBUG_DIR, `ai_${kind}.log`), entry, "utf-8");
  } catch {
    // Debug log khong duoc lam hong luong goi AI that neu ghi file loi (vd disk full).
  }
}

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

async function callAnthropic(agent: Agent, systemPrompt: string, userPrompt: string, imageUrl?: string, forceJson?: boolean): Promise<string> {
  if (forceJson) {
    systemPrompt += "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object.";
  }
  writeDebugLog("input", agent, `--- SYSTEM ---\n${systemPrompt}\n--- USER ---\n${userPrompt}${imageUrl ? `\n--- IMAGE ---\n${imageUrl}` : ""}`);
  const userContent = imageUrl
    ? [{ type: "text", text: userPrompt }, { type: "image", source: { type: "url", url: imageUrl } }]
    : userPrompt;
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
      messages: [{ role: "user", content: userContent }],
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
  writeDebugLog("output", agent, text);
  return text;
}

async function callOpenAiCompatible(agent: Agent, systemPrompt: string, userPrompt: string, imageUrl?: string, forceJson?: boolean): Promise<string> {
  if (forceJson) {
    systemPrompt += "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object.";
  }
  writeDebugLog("input", agent, `--- SYSTEM ---\n${systemPrompt}\n--- USER ---\n${userPrompt}${imageUrl ? `\n--- IMAGE ---\n${imageUrl}` : ""}`);
  const userContent = imageUrl
    ? [{ type: "text", text: userPrompt }, { type: "image_url", image_url: { url: imageUrl } }]
    : userPrompt;
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
        { role: "user", content: userContent },
      ],
      ...(forceJson ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.7,
      // Vai model qua 9router (vd Claude qua provider "cc") tra ve SSE streaming DU KHONG
      // truyen "stream" - ep tuong minh false de luon nhan 1 JSON object thuong, tranh crash
      // res.json() khi response thuc te la nhieu dong "data: {...}".
      stream: false,
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
  writeDebugLog("output", agent, text);
  return text;
}

// imageUrl: URL TUYET DOI (khong phai /uploads/... tuong doi) - AI goi qua API se tu tai anh ve,
// can truy cap duoc tu ben ngoai. Model khong ho tro vision se tuy provider (thuong bo qua block
// anh hoac loi ro rang) - khong tu dong kiem tra truoc, de nguyen trach nhiem chon model vision-capable
// cho nguoi cau hinh Agent.
export async function callAgent(agent: Agent, systemPrompt: string, userPrompt: string, imageUrl?: string, forceJson?: boolean): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  // Fallback to SiteConfig api keys if agent's key is not set
  if (!agent.apiKey) {
    const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    if (config?.aiProviderKeys) {
      const keys = config.aiProviderKeys as Record<string, string>;
      if (keys[agent.provider]) {
        agent.apiKey = keys[agent.provider];
      }
    }
  }

  if (agent.provider === "anthropic") {
    return callAnthropic(agent, systemPrompt, userPrompt, imageUrl, forceJson);
  }
  return callOpenAiCompatible(agent, systemPrompt, userPrompt, imageUrl, forceJson);
}

export async function generateImage(agent: Agent, prompt: string, size: string = "1024x1024"): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  if (!agent.apiKey) {
    const config = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    if (config?.aiProviderKeys) {
      const keys = config.aiProviderKeys as Record<string, string>;
      if (keys[agent.provider]) {
        agent.apiKey = keys[agent.provider];
      }
    }
  }

  // Anthropic does not support image generation
  if (agent.provider === "anthropic") {
    throw new AiCallError("Anthropic không hỗ trợ tạo ảnh qua API này");
  }

  const baseUrl = resolveBaseUrl(agent).replace(/\/$/, "").replace(/\/chat\/completions$/, "").replace(/\/v1$/, "");
  const endpoint = `${baseUrl}/v1/images/generations`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: agent.model,
      prompt: prompt,
      n: 1,
      size: size,
    }),
  });

  if (!res.ok) {
    throw new AiCallError(`Image Generation API lỗi ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as any;
  const url = data.data?.[0]?.url;
  if (!url) {
    throw new AiCallError("AI API không trả về URL ảnh");
  }
  return url;
}
