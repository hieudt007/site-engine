import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { MCPTool } from "../core/ToolRegistry.js";
import type { ChatHistoryItem } from "../../services/themeChat.js";
import { prisma } from "../../db.js";

// Gop context.history (lich su chat CU, tu cac luot truoc do) thanh 1 khoi van ban duy nhat, dang
// "USER:<noi dung>\n\nASSISTANT:<noi dung>" - dung rieng cho getChatHistoryTool ben duoi. Neu 1
// item.content la mang (vd sau nay luu truc tiep "messages" cua REPLY_TO_USER thay vi da gop san
// thanh string) thi tach moi phan tu thanh 1 dong ASSISTANT: rieng.
function formatHistoryBlock(history: ChatHistoryItem[]): string {
  if (!history.length) return "";
  const lines: string[] = [];
  for (const item of history) {
    const label = item.role === "user" ? "USER" : item.role === "tool" ? "TOOL_RESULT" : "ASSISTANT";
    // Turn assistant goi tool (native tool-calling) thuong khong co "content" text, chi co
    // "toolCalls" - hien ten tool + args ra thay vi in "ASSISTANT:null" vo nghia.
    if (item.role === "assistant" && item.toolCalls && item.toolCalls.length > 0) {
      lines.push(`${label}: [called ${item.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ")}]`);
      continue;
    }
    const content: unknown = item.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        lines.push(`${label}:${part}`);
      }
    } else {
      lines.push(`${label}:${content}`);
    }
  }
  return lines.join("\n\n");
}

// Ghi lai CHINH XAC args ma AI vua goi read_fields - GHI DE (khong noi tiep), dung khi debug vi
// debug-ai/ai_output.log co the bi ghi de boi request resume ngay sau do truoc khi kip xem.
function logReadFieldsCall(fields: unknown): void {
  try {
    const dir = path.join(process.cwd(), "debug-ai");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "read_fields_call.log"),
      `${new Date().toISOString()}\nAI goi read_fields voi fields: ${JSON.stringify(fields)}\n`,
      "utf-8"
    );
  } catch { }
}

export const readFieldsTool: MCPTool = {
  name: "read_fields",
  description: "Read current form values. {\"fields\": [\"field_1\", \"field_2\"]}",
  execute: async (args, context) => {
    const fields: string[] = Array.isArray(args.fields) ? args.fields : [];
    logReadFieldsCall(fields);
    // KHONG fallback doc "tat ca field" khi AI goi rong - se lam lo du lieu nhay cam (vd apiKey)
    // vao thang prompt gui cho AI ngoai. Bat AI phai tu chi ro tung field can, tra loi ro de no
    // tu goi lai dung cach thay vi doan mo lay het.
    if (fields.length === 0) {
      return "Error: list exact field names in \"fields\" (cannot be empty).";
    }
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({
        step: "read_request",
        payload: { fields, historyId: context.meta?.historyId ?? null }
      })}\n\n`);
    }
    throw new Error("PAUSE_FOR_REQUEST_FIELDS");
  }
};

export const fillFormTool: MCPTool = {
  name: "fill_form",
  description: "Fill form. {\"form_name\": \"name\", \"fields\": {\"field\": \"value\"}}",
  execute: async (args, context) => {
    const fields = args.fields || {};
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({
        step: "form_fill",
        payload: { action: "fill_form", formName: args.form_name, fields }
      })}\n\n`);
    }
    return `Form auto-filled on user's screen: ${JSON.stringify(fields)}\nUser will review and click Save. No further action needed.`;
  }
};

export const requestVisualQaTool: MCPTool = {
  name: "request_visual_qa",
  description: "Capture screenshot for UX/UI testing. {\"url\": \"path\"}",
  execute: async (args, context) => {
    const url = args.url || "";
    if (!url) return "Error: missing url.";
    if (context.reply) {
      context.reply.raw.write(`data: ${JSON.stringify({
        step: "test_request",
        payload: { action: "test_request", page: url, historyId: context.meta?.historyId ?? null }
      })}\n\n`);
    }
    throw new Error("PAUSE_FOR_QA");
  }
};

export const getCurrentPageTool: MCPTool = {
  name: "get_current_page",
  description: "Check which page the user is on. Returns current URL and title.",
  execute: async (args, context) => {
    return JSON.stringify({
      url: context.meta?.pageUrl || "Unknown",
      title: context.meta?.pageTitle || "Unknown",
    });
  }
};

// Lich su chat (context.history) khong con tu dong nhet vao moi lan goi AI - tach thanh tool rieng
// de AI tu goi khi can (xem formatHistoryBlock o tren). context.history CHI chua cac luot CU (tin
// nhan hien tai dang xu ly KHONG nam trong day - cac caller nhu aiChat.ts tu loc bo truoc khi
// truyen vao run()), nen tool nay khong bao gio tra ve tin nhan hien tai.
const DEFAULT_HISTORY_NUMBER = 5;
const DEFAULT_HISTORY_OFFSET = 0;

export const getChatHistoryTool: MCPTool = {
  name: "get_chat_history",
  description:
    '{"number": 5, "offset": 0}',
  execute: async (args, context) => {
    const number = Number.isFinite(args.number) ? Math.max(1, Math.floor(args.number)) : DEFAULT_HISTORY_NUMBER;
    const offset = Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : DEFAULT_HISTORY_OFFSET;

    const history = context.history || [];
    const end = history.length - offset;
    const start = Math.max(0, end - number);
    const sliced = history.slice(Math.max(0, start), Math.max(0, end));

    const block = formatHistoryBlock(sliced);
    return block || "(No chat history in requested range.)";
  },
};

// Danh cho task dai nhieu buoc (vd sua lien tiep nhieu file) - AI tu goi khi thay VUA XONG 1
// CHANG LON, de nen bot cac ket qua tool/agent tho da tich luy trong "messages" (BaseAgent.run())
// thanh 1 dong tom tat, tranh context phinh to dan qua tung buoc. Tool nay CHI ghi co hieu vao
// context.meta - viec nen that su do chinh run() lam (no moi giu duoc bien "messages" cuc bo).
export const finishSubtaskTool: MCPTool = {
  name: "finish_subtask",
  description:
    'Mark a big step in a long multi-step task done, compacting working memory to save tokens. Only use after actually finishing a group of work, not after every small step. {"summary": "what you just finished"}',
  execute: async (args, context) => {
    const summary = String(args.summary || "").trim();
    if (!summary) return "Error: missing summary.";
    context.meta.__pendingSubtaskSummary = summary;
    return "Recorded. Working memory will be compacted for the next step.";
  },
};

// Ban tom tat dai han ve NGUOI DANG CHAT (User.memories, cot moi) - KHAC han context.history/
// get_chat_history (lich su tho, tung luot rieng le): day la 1 khoi text DUY NHAT do CHINH AI tu
// nen/viet lai moi khi thay dang du thong tin moi (giong facebook_customer_memories.memory ben
// Facebook bot) - AI tu doc luc can, tu ghi luc thay dang, KHONG tu dong nhet vao moi luot (cung ly
// do context.history bi revert: tranh phinh token + tranh AI "hoc" lai loi cu tu chinh no).
export const getMemoryTool: MCPTool = {
  name: "get_memory",
  description: "Read your long-term summary notes about the current user (preferences, ongoing projects, past decisions). Empty args.",
  execute: async (_args, context) => {
    const userId = context.meta?.userId;
    if (!userId) return "Error: no user context available.";
    const user = await prisma.user.findUnique({ where: { leadbaseUserId: Number(userId) }, select: { memories: true } });
    return user?.memories?.trim() || "(No saved memory yet for this user.)";
  },
};

export const saveMemoryTool: MCPTool = {
  name: "save_memory",
  description:
    'Overwrite your long-term summary notes about the current user with a new full version (not an append - include everything still relevant, drop what is stale). Use sparingly, only when you learn something worth remembering long-term. {"content": "full updated memory text"}',
  execute: async (args, context) => {
    const userId = context.meta?.userId;
    if (!userId) return "Error: no user context available.";
    const content = String(args.content || "").trim();
    if (!content) return "Error: missing content.";
    await prisma.user.update({ where: { leadbaseUserId: Number(userId) }, data: { memories: content } });
    return "Memory saved.";
  },
};

// File tra cuu nhanh - moi heading "## " PHAI viet giong het nhan menu sidebar (views/admin/
// layout.liquid), xem ghi chu dau file docs/admin-menu-help.md. Doc lai tu dia MOI LAN goi (khong
// cache): file rat nho, va cho phep sua noi dung help ma khong can restart server.
const MENU_HELP_DOC_PATH = path.join(process.cwd(), "docs", "admin-menu-help.md");

async function loadMenuHelpSections(): Promise<Map<string, string> | null> {
  let markdown: string;
  try {
    markdown = await fsp.readFile(MENU_HELP_DOC_PATH, "utf-8");
  } catch {
    return null;
  }

  const sections = new Map<string, string>();
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentHeading !== null) sections.set(currentHeading, buffer.join("\n").trim());
    buffer = [];
  };
  for (const line of markdown.split("\n")) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      flush();
      currentHeading = match[1];
    } else if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

export const getMenuHelpTool: MCPTool = {
  name: "get_menu_help",
  description:
    'Look up the feature description + short usage guide for 1 item in the admin sidebar menu (docs/admin-menu-help.md). The "heading" must be written EXACTLY like the menu label the user sees (e.g. "Bài viết", "Cài đặt chung"). {"heading": "Bài viết"} - call with an empty/missing heading to list all available headings first if unsure of the exact label.',
  execute: async (args) => {
    const sections = await loadMenuHelpSections();
    if (!sections) return "Error: help doc (docs/admin-menu-help.md) not found.";

    const heading = String(args.heading || "").trim();
    if (!heading) {
      return `Available menu headings:\n${Array.from(sections.keys()).join("\n")}`;
    }

    const exact = sections.get(heading);
    if (exact !== undefined) return `## ${heading}\n${exact}`;

    // Khong khop tuyet doi (vd AI go sai hoa/thuong hoac thua khoang trang) - thu khop khoan dung,
    // khong doan mo sang heading khac de tranh tra loi lac de.
    const normalized = heading.toLowerCase();
    for (const [key, content] of sections) {
      if (key.toLowerCase() === normalized) return `## ${key}\n${content}`;
    }

    return `Error: no menu heading matches "${heading}". Available headings: ${Array.from(sections.keys()).join(", ")}`;
  },
};

// Thong tin CONG KHAI ve website (KHONG bao gio tra secret: bo qua turnstileSecretKey/
// aiProviderKeys/goongApiKey/r2*/customHeadScript-FooterScript/adminChatAgentId/cskhAgentId - day
// la tool AI tro ly co the goi tu do, khong duoc lam kenh lo bi mat cau hinh).
export const getWebsiteInfoTool: MCPTool = {
  name: "get_website_info",
  description:
    "Get basic public info about this website: domain, name, tagline, contact info, social links, site type (blog/ecommerce), URL prefixes, and content counts. Empty args.",
  execute: async () => {
    const site = await prisma.siteConfig.findUnique({ where: { id: "singleton" } });
    if (!site) return "Error: site chưa được cấu hình (chưa có SiteConfig).";

    const [totalPosts, totalPages, totalProducts] = await Promise.all([
      prisma.post.count({ where: { type: "post" } }),
      prisma.post.count({ where: { type: "page" } }),
      site.siteType === "ecommerce" ? prisma.productCache.count() : Promise.resolve(null),
    ]);

    return JSON.stringify({
      domain: site.domain,
      siteName: site.siteName,
      tagline: site.tagline,
      companyName: site.companyName,
      contactEmail: site.contactEmail,
      contactPhone: site.contactPhone,
      contactAddress: site.contactAddress,
      socialLinks: site.socialLinks,
      businessLicense: site.businessLicense,
      siteType: site.siteType,
      postSlugPrefix: site.postSlugPrefix,
      pageSlugPrefix: site.pageSlugPrefix,
      productSlugPrefix: site.productSlugPrefix,
      totalPosts,
      totalPages,
      totalProducts,
    });
  },
};
