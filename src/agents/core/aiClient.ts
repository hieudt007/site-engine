import fs from "node:fs";
import path from "node:path";
import type { Agent } from "@prisma/client";
import { prisma } from "../../db.js";
import { CacheService } from "../../services/CacheService.js";
import { assertSafeOutboundUrl } from "../../security/ssrfGuard.js";
import { decryptNodeString } from "../../nodeCrypt.js";
import { logger } from "../../logger.js";

// Agent.apiKey (va SiteConfig.aiProviderKeys) luu duoi dang ma hoa (xem routes/admin/agents.ts,
// nodeCrypt.ts) - ham nay giai ma dung 1 cho duy nhat, uu tien key rieng cua agent, fallback ve
// key chung cua provider trong SiteConfig neu agent chua tu cau hinh.
export async function resolveAgentApiKey(agent: Agent): Promise<string | null> {
  if (agent.apiKey) return decryptNodeString(agent.apiKey);
  const config = await CacheService.getSiteConfig();
  const keys = (config?.aiProviderKeys as Record<string, string> | null) || {};
  const raw = keys[agent.provider];
  return raw ? decryptNodeString(raw) : null;
}

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

// Debug: APPEND (khong ghi de) thoi diem nhan tung chunk SSE tu 9Router khi settings.stream=true (Agent.settings) - huu
// ich de kiem tra 9Router co forward tung manh real-time hay bi buffer o tang gateway.
function appendStreamTimingLog(agent: Agent, chunkTimestamps: number[], startedAt: number): void {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    const offsets = chunkTimestamps.map((t) => `+${t - startedAt}ms`).join(", ");
    const line = `${stamp} | agent=${agent.name} (${agent.provider}/${agent.model}) | chunks=${chunkTimestamps.length} | ${offsets}\n`;
    fs.appendFileSync(path.join(DEBUG_DIR, "ai_stream_timing.log"), line, "utf-8");
  } catch {}
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

// Doc cac tham so PHU tu Agent.settings (Json?, gop chung 1 cot thay vi tung cot rieng - dung
// chung quy uoc key snake_case voi ai_agents.settings ben lead-base-node, xem schema.prisma). Chi
// 3 key hien dung: stream/max_tokens/temperature - the trong cung 1 ham de moi noi doc deu ra
// default nhat quan, khong lap lai logic parse o nhieu cho.
function getAgentSettings(agent: Agent): { stream: boolean; maxTokens: number; temperature: number } {
  const settings = (agent.settings as Record<string, any>) || {};
  return {
    stream: settings.stream === true,
    maxTokens: Number.isFinite(Number(settings.max_tokens)) && Number(settings.max_tokens) > 0 ? Number(settings.max_tokens) : 8000,
    temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.7,
  };
}

async function resolveBaseUrl(agent: Agent): Promise<string> {
  if (agent.baseUrl) {
    // agent.baseUrl la INPUT NGUOI DUNG (nhap qua /admin/api/agents, xem routes/admin/agents.ts) -
    // KHAC DEFAULT_BASE_URLS ben duoi la hang cung tin cay. PHAI kiem tra lai NGAY LUC GOI (khong
    // chi luc luu o route admin), phong DNS tro toi IP noi bo SAU KHI da luu (DNS rebinding/TOCTOU).
    try {
      await assertSafeOutboundUrl(agent.baseUrl);
    } catch (err: any) {
      throw new AiCallError(`Agent "${agent.name}" có baseUrl không an toàn: ${err.message}`);
    }
    return agent.baseUrl;
  }
  const fallback = DEFAULT_BASE_URLS[agent.provider];
  if (!fallback) {
    throw new AiCallError(`Provider "${agent.provider}" cần baseUrl riêng, chưa cấu hình trong Agent`);
  }
  return fallback;
}

// KHONG duoc nhoi nguyen res.text() vao message tra ve nguoi goi/AI - voi agent.baseUrl do NGUOI
// DUNG chon, response nay co the la du lieu tu 1 service NOI BO ma ho khong duoc phep doc truc tiep
// (SSRF data-exfil qua thong bao loi). Chi ghi chi tiet o SERVER LOG, tra ve message chung kem status.
async function readErrorSafely(res: Response, label: string, agent: Agent): Promise<string> {
  const bodyText = await res.text().catch(() => "");
  logger.error({ status: res.status, agent: agent.name, provider: agent.provider, bodyText }, `[aiClient] ${label} lỗi`);
  return `${label} lỗi ${res.status}. Xem log server để biết chi tiết.`;
}

async function callAnthropic(agent: Agent, systemPrompt: string, userPrompt: string, imageUrl?: string, forceJson?: boolean): Promise<string> {
  if (forceJson) {
    systemPrompt += "\n\nCRITICAL INSTRUCTION: You MUST return a valid JSON object.";
  }
  const { maxTokens } = getAgentSettings(agent);
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
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "Anthropic API", agent));
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
  const { maxTokens, temperature } = getAgentSettings(agent);
  writeDebugLog("input", agent, `--- SYSTEM ---\n${systemPrompt}\n--- USER ---\n${userPrompt}${imageUrl ? `\n--- IMAGE ---\n${imageUrl}` : ""}`);
  const userContent = imageUrl
    ? [{ type: "text", text: userPrompt }, { type: "image_url", image_url: { url: imageUrl } }]
    : userPrompt;
  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "");
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
      temperature,
      max_tokens: maxTokens,
      // Vai model qua 9router (vd Claude qua provider "cc") tra ve SSE streaming DU KHONG
      // truyen "stream" - ep tuong minh false de luon nhan 1 JSON object thuong, tranh crash
      // res.json() khi response thuc te la nhieu dong "data: {...}".
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "AI API", agent));
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
  agent.apiKey = await resolveAgentApiKey(agent);

  if (agent.provider === "anthropic") {
    return callAnthropic(agent, systemPrompt, userPrompt, imageUrl, forceJson);
  }
  return callOpenAiCompatible(agent, systemPrompt, userPrompt, imageUrl, forceJson);
}

export interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ConversationTurn {
  role: "user" | "assistant" | "tool";
  content: string | null;
  imageUrl?: string;
  // Chi dung khi role="assistant" va co goi tool - id/name/args THAT provider tra ve (native
  // tool-calling that su qua 9Router, KHONG con la JSON tu chep trong text nhu truoc).
  toolCalls?: ToolCallData[];
  // Chi dung khi role="tool" - id THAT khop voi 1 phan tu toolCalls o turn assistant truoc do.
  toolCallId?: string;
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, any> };
}

export interface AgentCallResult {
  content: string | null;
  toolCalls: ToolCallData[];
}

// Goi AI voi LICH SU DA TURN THAT + native tool-calling (OpenAI-compatible "tools"/"tool_calls",
// dung qua 9Router - 9Router tu dich sang dung format provider dich that su vd Claude/Gemini, xem
// thao luan thiet ke). Thay the hoan toan cach cu (bat AI tu viet JSON trong text content roi tu
// parse lai) - AI chi con can viet "content" la text thuong (khong bat buoc dinh dang gi), con
// tool call duoc provider dam bao dung cau truc o tang API, khong con phu thuoc AI "tu giac".
export async function callAgentConversation(
  agent: Agent,
  systemPrompt: string,
  turns: ConversationTurn[],
  tools: ToolDef[],
  // Goi 1 lan duy nhat NGAY KHI nhan duoc byte dau tien tu provider (chi co y nghia khi agent.stream
  // = true) - dung de BaseAgent bao hieu "AI da bat dau xu ly" (typing indicator) qua SSE.
  onFirstByte?: () => void,
  // Goi NHIEU LAN voi tung DOAN MOI cua text content ngay khi nhan duoc (chi co y nghia khi
  // agent.stream = true) - gio la field "content" that su cua delta, khong con phai tu parse dang
  // do tu 1 khoi JSON dang gui dan nhu truoc (xem lich su thiet ke cu: extractPartialMessage()).
  onMessageDelta?: (delta: string) => void
): Promise<AgentCallResult> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  agent.apiKey = await resolveAgentApiKey(agent);

  const { stream, maxTokens, temperature } = getAgentSettings(agent);

  writeDebugLog(
    "input",
    agent,
    `--- SYSTEM ---\n${systemPrompt}\n` +
      turns
        .map((t) => {
          const toolCallsStr = t.toolCalls ? `\ntool_calls: ${JSON.stringify(t.toolCalls)}` : "";
          return `--- ${t.role.toUpperCase()}${t.toolCallId ? ` (${t.toolCallId})` : ""} ---\n${t.content ?? ""}${toolCallsStr}${t.imageUrl ? `\n[image] ${t.imageUrl}` : ""}`;
        })
        .join("\n")
  );

  // provider="anthropic" (goi thang api.anthropic.com, KHONG qua 9Router) hien khong co agent nao
  // dung (da kiem tra DB) - CHUA lam native tool-calling rieng cho nhanh nay, chi tra ve text don
  // gian (khong tool_calls) de khong vo type. 9Router (provider="ai-router", nhanh duoi) moi la
  // duong dang dung that su, tu dich sang Claude/Gemini/... khi can.
  if (agent.provider === "anthropic") {
    const messages = turns.map((t) => ({
      role: t.role === "tool" ? "user" : t.role,
      content: t.imageUrl
        ? [{ type: "text", text: t.content ?? "" }, { type: "image", source: { type: "url", url: t.imageUrl } }]
        : t.content ?? "",
    }));
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": agent.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: agent.model, max_tokens: maxTokens, system: systemPrompt, messages }),
    });
    if (!res.ok) {
      throw new AiCallError(await readErrorSafely(res, "Anthropic API", agent));
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === "text")?.text ?? "";
    writeDebugLog("output", agent, text);
    return { content: text, toolCalls: [] };
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...turns.map((t) => {
      if (t.role === "tool") {
        return { role: "tool", tool_call_id: t.toolCallId, content: t.content ?? "" };
      }
      if (t.role === "assistant" && t.toolCalls && t.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: t.content,
          tool_calls: t.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      return {
        role: t.role,
        content: t.imageUrl
          ? [{ type: "text", text: t.content ?? "" }, { type: "image_url", image_url: { url: t.imageUrl } }]
          : t.content,
      };
    }),
  ];
  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: agent.model,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      temperature,
      max_tokens: maxTokens,
      stream,
    }),
  });
  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "AI API", agent));
  }

  let content: string | null = null;
  let toolCalls: ToolCallData[] = [];

  if (stream) {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new AiCallError("AI API không trả về stream.");
    }
    const decoder = new TextDecoder();
    const startedAt = Date.now();
    const chunkTimestamps: number[] = [];
    let buffer = "";
    let firedFirstByte = false;
    let gatheredContent = "";
    // Tool call co the stream ROI RAC nhieu chunk (id/name den truoc, "arguments" den dan tung
    // manh) - gom theo "index" (vi tri trong mang tool_calls cua chunk delta, KHONG phai id) roi
    // rap lai luc cuoi, giong het cach cac SDK chinh thuc lam.
    const toolCallAcc = new Map<number, { id: string; name: string; args: string }>();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!firedFirstByte) {
        firedFirstByte = true;
        onFirstByte?.();
      }
      chunkTimestamps.push(Date.now());
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
          };
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            gatheredContent += delta.content;
            onMessageDelta?.(delta.content);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallAcc.get(tc.index) || { id: "", name: "", args: "" };
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
              toolCallAcc.set(tc.index, existing);
            }
          }
        } catch {
          // Chunk chua du 1 dong JSON hoan chinh (hiem, buffer se gop tiep o vong sau) - bo qua.
        }
      }
    }
    appendStreamTimingLog(agent, chunkTimestamps, startedAt);
    content = gatheredContent || null;
    toolCalls = Array.from(toolCallAcc.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => {
        let args: Record<string, any> = {};
        try {
          args = tc.args ? JSON.parse(tc.args) : {};
        } catch {
          // Provider hiem khi gui arguments khong phai JSON hop le - coi nhu rong, khong crash ca luot.
        }
        return { id: tc.id, name: tc.name, args };
      });
  } else {
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    };
    const message = data.choices?.[0]?.message;
    content = message?.content ?? null;
    toolCalls = (message?.tool_calls || []).map((tc) => {
      let args: Record<string, any> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Nhu tren - khong crash ca luot vi 1 tool call parse loi.
      }
      return { id: tc.id, name: tc.function.name, args };
    });
  }

  // Mot so model reasoning (DeepSeek-R1, QwQ...) tu dong chen <think></think> (ke ca rong) vao
  // dau field "content" - don sach truoc khi tra ve/luu lai (khong lam duoc voi tung mieng delta
  // dang stream, chi lam duoc voi ban day du cuoi cung - xem BaseAgent.streamNarration()/message
  // cuoi cung, chap nhan chunk stream truc tiep co the thoang thay tag nay voi model loai nay).
  if (content) {
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() || null;
  }
  // Mot so model, khi goi tool ma khong co gi de noi them, tra ve CHUOI TEXT "null" (4 ky tu) thay
  // vi that su bo trong "content" - co le do quen voi thoi ky con phai dien field JSON. Coi nhu
  // rong, tranh chuoi "null" bi hieu nham la narration/cau tra loi that.
  if (content && content.trim().toLowerCase() === "null") {
    content = null;
  }

  if (!content && toolCalls.length === 0) {
    throw new AiCallError("AI API trả về rỗng");
  }
  writeDebugLog("output", agent, JSON.stringify({ content, tool_calls: toolCalls }));
  return { content, toolCalls };
}

export async function generateImage(agent: Agent, prompt: string, size: string = "1024x1024"): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  agent.apiKey = await resolveAgentApiKey(agent);

  // Anthropic does not support image generation
  if (agent.provider === "anthropic") {
    throw new AiCallError("Anthropic không hỗ trợ tạo ảnh qua API này");
  }

  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "").replace(/\/chat\/completions$/, "").replace(/\/v1$/, "");
  const endpoint = `${baseUrl}/v1/images/generations`;

  // Tham so PHU tu Agent.settings (giong quy uoc getAgentSettings() o tren, xem 9Router docs UI
  // cho /v1/images/generations) - "output_format" CHI gui khi co set tuong minh, KHONG ep default
  // gi ca: doi response tu {data:[{url}]} sang {data:[{b64_json}]} neu chon base64, code duoi van
  // dang doc "url" - chua ho tro doc b64_json, tranh vo response parsing hien tai neu khong ai chu
  // dinh doi.
  const settings = (agent.settings as Record<string, any>) || {};
  const n = Number.isFinite(Number(settings.n)) && Number(settings.n) > 0 ? Number(settings.n) : 1;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: agent.model,
      prompt: prompt,
      n,
      size: size,
      ...(settings.output_format ? { output_format: settings.output_format } : {}),
    }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "Image Generation API", agent));
  }
  const data = (await res.json()) as any;
  const url = data.data?.[0]?.url;
  if (!url) {
    throw new AiCallError("AI API không trả về URL ảnh");
  }
  return url;
}

export async function webSearch(agent: Agent, query: string): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  agent.apiKey = await resolveAgentApiKey(agent);

  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "");
  // Use endpoint from agent if available, fallback to /search
  const endpointPath = agent.endpoint || "/search";
  const endpoint = `${baseUrl}${endpointPath}`;

  // Tham so PHU tu Agent.settings (xem 9Router docs UI cho /v1/search) - giu nguyen default CU
  // (search_type "news", max_results 5, country "vietnam", language "vi") neu khong cau hinh gi,
  // tranh doi hanh vi hien tai cho agent nao chua set settings.
  const settings = (agent.settings as Record<string, any>) || {};
  const searchType = typeof settings.search_type === "string" ? settings.search_type : "news";
  const maxResults = Number.isFinite(Number(settings.max_results)) && Number(settings.max_results) > 0 ? Number(settings.max_results) : 5;
  const country = typeof settings.country === "string" ? settings.country : "vietnam";
  const language = typeof settings.language === "string" ? settings.language : "vi";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: agent.model,
      query: query,
      search_type: searchType,
      max_results: maxResults,
      country,
      language
    }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "Web Search API", agent));
  }
  const data = (await res.json()) as any;
  
  if (data.results && Array.isArray(data.results)) {
    const formattedResults = data.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      published_at: r.published_at,
    }));
    return JSON.stringify({
      query: data.query || query,
      results: formattedResults
    });
  }

  const reply = data.content || data.results || data.text;
  
  if (!reply) {
    return JSON.stringify(data);
  }
  return typeof reply === 'object' ? JSON.stringify(reply) : String(reply);
}

export async function generateVideo(agent: Agent, prompt: string): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  agent.apiKey = await resolveAgentApiKey(agent);

  if (agent.provider === "anthropic") {
    throw new AiCallError("Anthropic không hỗ trợ tạo video qua API này");
  }

  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "");
  const endpointPath = agent.endpoint || "/videos/generations";
  const endpoint = `${baseUrl}${endpointPath}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: agent.model, prompt }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "Video Generation API", agent));
  }
  const data = (await res.json()) as any;
  const url = data.data?.[0]?.url;
  if (!url) {
    throw new AiCallError("AI API không trả về URL video");
  }
  return url;
}

export async function createEmbedding(agent: Agent, input: string): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  agent.apiKey = await resolveAgentApiKey(agent);

  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "");
  const endpointPath = agent.endpoint || "/embeddings";
  const endpoint = `${baseUrl}${endpointPath}`;

  // "dimensions" CHI gui khi co set tuong minh trong Agent.settings (xem 9Router docs UI cho
  // /v1/embeddings) - de trong = dung mac dinh cua model.
  const settings = (agent.settings as Record<string, any>) || {};
  const dimensions = Number.isFinite(Number(settings.dimensions)) && Number(settings.dimensions) > 0 ? Number(settings.dimensions) : undefined;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: agent.model, input, ...(dimensions ? { dimensions } : {}) }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "Embeddings API", agent));
  }
  const data = (await res.json()) as any;
  return JSON.stringify(data);
}

export async function webFetch(agent: Agent, url: string): Promise<string> {
  if (!agent.isActive) {
    throw new AiCallError(`Agent "${agent.name}" đang tắt`);
  }

  agent.apiKey = await resolveAgentApiKey(agent);

  const baseUrl = (await resolveBaseUrl(agent)).replace(/\/$/, "");
  const endpointPath = agent.endpoint || "/web/fetch";
  const endpoint = `${baseUrl}${endpointPath}`;

  // Tham so PHU tu Agent.settings (xem 9Router docs UI cho /v1/web/fetch) - giu nguyen default CU
  // (format "markdown", max_characters 0 = khong gioi han) neu khong cau hinh gi.
  const settings = (agent.settings as Record<string, any>) || {};
  const format = typeof settings.format === "string" ? settings.format : "markdown";
  const maxChars = Number.isFinite(Number(settings.max_chars)) && Number(settings.max_chars) >= 0 ? Number(settings.max_chars) : 0;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agent.apiKey ? { Authorization: `Bearer ${agent.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: agent.model,
      url: url,
      format,
      max_characters: maxChars,
    }),
  });

  if (!res.ok) {
    throw new AiCallError(await readErrorSafely(res, "Web Fetch API", agent));
  }
  const data = (await res.json()) as any;
  const reply = data.content || data.results || data.text;
  
  if (!reply) {
    return JSON.stringify(data);
  }
  return typeof reply === 'object' ? JSON.stringify(reply) : String(reply);
}
