import type { Agent } from "@prisma/client";
import { callAgent } from "./aiClient.js";
import { getContract } from "./themeContract.js";
import { validateThemeFile } from "./themeValidator.js";

const RECENT_HISTORY_LIMIT = 3;

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export type ClassifyMode = "chat" | "edit";

export interface ClassifyResult {
  mode: ClassifyMode;
  files: string[];
  reply: string;
  intentUpdate: string | null;
}

export interface EditFileResult {
  file: string;
  ok: boolean;
  content?: string;
  errors: string[];
}

export interface EditResult {
  files: EditFileResult[];
  memoryUpdate: string | null;
}

function formatHistory(history: ChatHistoryItem[]): string {
  if (!history.length) return "(chưa có lịch sử chat trước đó)";
  return history
    .slice(-RECENT_HISTORY_LIMIT)
    .map((h) => `${h.role === "user" ? "Người dùng" : "AI"}: ${h.content}`)
    .join("\n");
}

// Lan goi 1: phan loai y dinh, dung ca cho tin nhan dau tien lan cac luot sau. AI CHI duoc tra
// MODE: edit khi da biet ro sua GI va O DAU (kien truc/layout) — neu con mo ho ve VI TRI/CAU TRUC
// can sua thi phai hoi lai (MODE: chat), KHONG duoc doan. Gu tham my (mau/font...) thi AI tu quyet
// theo Dinh huong mong muon da ghi trong THEME.md, khong hoi.
function buildClassifySystemPrompt(): string {
  return [
    "Bạn là trợ lý AI chỉnh sửa theme website (Liquid + Tailwind CSS), đang trò chuyện với admin qua khung chat.",
    "Đây là LẦN GỌI PHÂN LOẠI — bạn KHÔNG sửa file ở bước này, chỉ quyết định bước tiếp theo.",
    "",
    "Trả lời ĐÚNG định dạng sau, không thêm lời dẫn/giải thích, không markdown code fence:",
    "MODE: chat hoặc edit",
    "FILES: <tên file, cách nhau bởi dấu phẩy — CHỈ điền khi MODE là edit, để trống nếu chat>",
    "REPLY: <câu trả lời/câu hỏi gửi cho admin, 1-3 câu, tiếng Việt tự nhiên>",
    "INTENT_UPDATE: <nếu admin vừa nói ra 1 định hướng/gu thiết kế mới (màu sắc, phong cách, bố cục mong muốn...), ghi lại TOÀN BỘ bản tóm tắt định hướng đã biết từ trước tới giờ (không chỉ điều mới) — để trống nếu không có gì mới>",
    "",
    "QUY TẮC chọn MODE:",
    "- MODE: edit CHỈ khi bạn đã biết rõ CẦN SỬA GÌ và Ở ĐÂU/FILE NÀO (kiến trúc/layout/vị trí cụ thể). " +
      "Nếu yêu cầu còn mơ hồ về VỊ TRÍ hoặc CẤU TRÚC cần sửa (ví dụ chưa rõ đặt ở trang nào, phần nào của layout), " +
      "PHẢI trả MODE: chat và hỏi lại cho rõ vị trí/cấu trúc — KHÔNG được đoán.",
    "- KHÔNG hỏi lại về GU THẨM MỸ (màu gì, font gì, phong cách ra sao) nếu chỉ mơ hồ về thẩm mỹ — cứ tự quyết " +
      "theo phần 'Định hướng mong muốn' đã ghi trong trí nhớ theme, vì hỏi lại phần này gây phiền.",
    "- Khi MODE: edit, FILES phải liệt kê ĐẦY ĐỦ mọi file có khả năng chứa cùng thuộc tính cần đổi (ví dụ đổi " +
      "max-width/container có thể lặp ở layout.liquid, _header.liquid, _footer.liquid) — không chỉ đúng 1 file " +
      "admin nhắc tên, để tránh sửa sót gây lệch giữa các trang.",
  ].join("\n");
}

function buildClassifyUserPrompt(themeMd: string, history: ChatHistoryItem[], message: string): string {
  return [
    "Trí nhớ theme hiện tại (THEME.md):",
    "```markdown",
    themeMd,
    "```",
    "",
    "3 tin nhắn gần nhất trong cuộc trò chuyện:",
    formatHistory(history),
    "",
    `Tin nhắn mới nhất của admin: ${message}`,
  ].join("\n");
}

function parseClassify(raw: string): ClassifyResult {
  const modeMatch = raw.match(/MODE:[ \t]*(chat|edit)/i);
  const filesMatch = raw.match(/FILES:[ \t]*(.*)/);
  const replyMatch = raw.match(/REPLY:\s*([\s\S]*?)(?:\nINTENT_UPDATE:|$)/);
  const intentMatch = raw.match(/INTENT_UPDATE:\s*([\s\S]*)$/);

  const mode: ClassifyMode = modeMatch?.[1]?.toLowerCase() === "edit" ? "edit" : "chat";
  const files = (filesMatch?.[1] ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const reply = replyMatch ? replyMatch[1].trim() : raw.trim();
  const intentRaw = intentMatch ? intentMatch[1].trim() : "";
  const intentUpdate = intentRaw.length ? intentRaw : null;

  return { mode, files, reply, intentUpdate };
}

export async function classifyChatMessage(
  agent: Agent,
  themeMd: string,
  history: ChatHistoryItem[],
  message: string,
): Promise<ClassifyResult> {
  const raw = await callAgent(agent, buildClassifySystemPrompt(), buildClassifyUserPrompt(themeMd, history, message));
  return parseClassify(raw);
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function buildEditSystemPrompt(files: string[]): string {
  const contractNotes = files
    .map((file) => {
      const contract = getContract(file);
      if (!contract) return `File "${file}": không có hợp đồng ràng buộc riêng (CSS/JS tuỳ chỉnh).`;
      return [
        `File "${file}" (${contract.description}):`,
        ...contract.requiredSubstrings.map((s) => `  - Phải giữ nguyên văn chuỗi/thẻ: ${s}`),
        ...contract.requiredIds.map((id) => `  - Phải có phần tử HTML với id="${id}"`),
        `  - Ghi chú: ${contract.notes}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Bạn là chuyên gia thiết kế giao diện web, sửa template Liquid (LiquidJS) + Tailwind CSS theo yêu cầu admin.",
    "Chỉ sửa ĐÚNG các file được liệt kê dưới đây, giữ nguyên các phần không liên quan tới yêu cầu.",
    "",
    "Hợp đồng từng file (BẮT BUỘC tuân thủ, hệ thống sẽ tự kiểm tra và bắt sửa lại nếu vi phạm):",
    contractNotes,
    "",
    "Trả lời ĐÚNG định dạng sau cho MỖI file, không thêm lời dẫn/giải thích, không markdown code fence:",
    "### FILE: <tên file>",
    "<toàn bộ nội dung mới của file>",
    "(lặp lại ### FILE: ... cho từng file cần sửa)",
    "",
    "Cuối cùng, thêm:",
    "### MEMORY_UPDATE:",
    "<bản tóm tắt ĐẦY ĐỦ các quyết định/thực trạng thiết kế đã áp dụng vào code cho tới nay (không chỉ thay đổi vừa rồi) — dùng để AI lần sau đọc lại biết hiện trạng thật của code>",
  ].join("\n");
}

function buildEditUserPrompt(
  themeMd: string,
  history: ChatHistoryItem[],
  message: string,
  fileContents: Record<string, string>,
): string {
  const filesBlock = Object.entries(fileContents)
    .map(([file, content]) => `--- Nội dung hiện tại của ${file} ---\n${content}`)
    .join("\n\n");

  return [
    "Trí nhớ theme hiện tại (THEME.md):",
    "```markdown",
    themeMd,
    "```",
    "",
    "3 tin nhắn gần nhất trong cuộc trò chuyện:",
    formatHistory(history),
    "",
    `Yêu cầu mới nhất của admin: ${message}`,
    "",
    filesBlock,
  ].join("\n");
}

function parseEditResponse(raw: string, requestedFiles: string[]): { fileContents: Record<string, string>; memoryUpdate: string | null } {
  const fileContents: Record<string, string> = {};
  const fileBlockRegex = /### FILE:\s*(.+?)\n([\s\S]*?)(?=\n### FILE:|\n### MEMORY_UPDATE:|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fileBlockRegex.exec(raw)) !== null) {
    const file = match[1].trim();
    if (requestedFiles.includes(file)) {
      fileContents[file] = stripCodeFence(match[2].trim());
    }
  }

  const memoryMatch = raw.match(/### MEMORY_UPDATE:\s*([\s\S]*)$/);
  const memoryUpdate = memoryMatch ? memoryMatch[1].trim() : null;

  return { fileContents, memoryUpdate: memoryUpdate && memoryUpdate.length ? memoryUpdate : null };
}

// Lan goi 2: chi chay khi classify tra MODE=edit. Nhan noi dung THAT SU cua tung file (server da
// doc tu dia) de AI sua dua tren code that, khong doan mo. Sau khi AI tra ve, validate TUNG FILE
// qua themeValidator.ts — file loi thi GIU BAN GOC (khong ghi de), giong nguyen tac cua
// themeGenerator.ts (theme luon la 1 bo hoan chinh, khong bao gio nua vari).
export async function editThemeFiles(
  agent: Agent,
  themeMd: string,
  history: ChatHistoryItem[],
  message: string,
  fileContents: Record<string, string>,
): Promise<EditResult> {
  const requestedFiles = Object.keys(fileContents);
  const raw = await callAgent(
    agent,
    buildEditSystemPrompt(requestedFiles),
    buildEditUserPrompt(themeMd, history, message, fileContents),
  );
  const { fileContents: newContents, memoryUpdate } = parseEditResponse(raw, requestedFiles);

  const results: EditFileResult[] = [];
  for (const file of requestedFiles) {
    const newContent = newContents[file];
    if (!newContent) {
      results.push({ file, ok: false, errors: ["AI không trả về nội dung cho file này"] });
      continue;
    }
    const contract = getContract(file);
    if (!contract) {
      // Asset CSS/JS - khong co hop dong Liquid de validate, chap nhan thang.
      results.push({ file, ok: true, content: newContent, errors: [] });
      continue;
    }
    const validation = await validateThemeFile(file, newContent);
    results.push({ file, ok: validation.ok, content: validation.ok ? newContent : undefined, errors: validation.errors });
  }

  return { files: results, memoryUpdate: results.some((r) => r.ok) ? memoryUpdate : null };
}
