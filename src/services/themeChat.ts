import fs from "node:fs/promises";
import path from "node:path";
import type { Agent } from "@prisma/client";
import { prisma } from "../db.js";
import { callAgent } from "./aiClient.js";
import { getAllThemeAssetFiles, getSelectableFiles, getContractFromDisk } from "./themeContract.js";
import { validateThemeFile } from "./themeValidator.js";

const RECENT_HISTORY_LIMIT = 5;
const MAX_ATTEMPTS = 3;

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface ReplaceBlock {
  original: string;
  replacement: string;
}

export interface AgentAction {
  type: "SEARCH_CODE" | "READ_FILES" | "REPLACE_CODE" | "OVERWRITE_FILE" | "UPDATE_THEME_MEMORY" | "GET_DESIGN_SYSTEM" | "REPLY_TO_USER" | "LIST_FILES" | "FINISH_SUBTASK" | "USE_SKILL" | "GET_PLUGIN_CONTRACTS";
  payload: any;
}

function formatHistory(history: ChatHistoryItem[]): string {
  if (!history.length) return "(chưa có lịch sử chat trước đó)";
  return history
    .slice(-RECENT_HISTORY_LIMIT)
    .map((h) => `${h.role === "user" ? "USER" : "SYSTEM"}: ${h.content}`)
    .join("\n\n");
}

import { getAllAgentSkills } from "./themeSkills.js";

export async function buildAgentSystemPrompt(
  slug: string,
  isRedesign: boolean = false,
  hasOpenFiles: boolean = false
): Promise<string> {
  const availableSkills = await getAllAgentSkills();

  const promptParts: string[] = [];

  // [MODULE 1: QUY TẮC CƠ BẢN]
  promptParts.push(
    "# 1. QUY TẮC CƠ BẢN",
    "- Bạn là một Frontend AI Agent làm nhiệm vụ tạo và tùy chỉnh giao diện (Theme) cho hệ thống Site Engine dựa trên Liquid/CSS/JS.",
    "- BẠN CÓ THỂ SỬA CẢ GIAO DIỆN CỦA THEME VÀ CỦA CÁC PLUGIN (ADDON). NẾU USER YÊU CẦU SỬA GIAO DIỆN PLUGIN, HÃY DÙNG `LIST_FILES` ĐỂ QUÉT VÀ TÌM FILE GIAO DIỆN PLUGIN TRONG THƯ MỤC `addons/` VÀ SỬA CHÚNG NHƯ BÌNH THƯỜNG.",
    "- BẠN PHẢI GỌI CÁC TOOL (Công cụ) ĐỂ THỰC HIỆN CÔNG VIỆC, KHÔNG ĐƯỢC CHỈ TRẢ LỜI SUÔNG.",
    "- MỖI LẦN TRẢ LỜI CỦA BẠN CHỈ ĐƯỢC CHỨA CÁC TOOL GỌI Ở ĐỊNH DẠNG CỤ THỂ, NGOÀI RA KHÔNG GIẢI THÍCH GÌ THÊM.",
    "- Nếu gặp tác vụ phức tạp, HÃY DÙNG `FINISH_SUBTASK` ĐỂ LÀM TỪNG BƯỚC MỘT."
  );

  // [MODULE 1.5: CHÍNH SÁCH THIẾT KẾ BẮT BUỘC]
  promptParts.push(
    "# 2. CHÍNH SÁCH THIẾT KẾ BẮT BUỘC",
    "Nếu `## Quy ước & gu thẩm mỹ chung` trong THEME.md đang trống hoặc User muốn đổi phong cách, BẮT BUỘC thực hiện theo trình tự:",
    "1. GỌI `GET_DESIGN_SYSTEM` với từ khoá NGÀNH NGHỀ BẰNG TIẾNG ANH (vd: fashion, tech).",
    "2. GỌI `UPDATE_THEME_MEMORY` để lưu kết quả vào THEME.md.",
    "3. GỌI `REPLY_TO_USER` đề xuất phong cách và DỪNG LẠI CHỜ DUYỆT (CẤM code HTML/CSS ở bước này).",
    "4. Khi User phản hồi ĐỒNG Ý, mới bắt đầu quá trình code."
  );

  // [MODULE 2: CÁC TOOL CƠ BẢN]
  const toolsModule = [
    "# 3. DANH SÁCH TOOL ĐƯỢC PHÉP GỌI",
    "",
    "1. Liệt kê cấu trúc thư mục (cây thư mục):",
    "### LIST_FILES:",
    "(Không cần tham số, trả về danh sách toàn bộ các file .liquid, .css, .js hiện có trong theme để bạn biết đường mở)",
    "",
    "2. Tìm kiếm code:",
    "### SEARCH_CODE:",
    "QUERY: <từ khóa, class, id cần tìm>",
    "REASON: <lý do tìm kiếm>",
    "",
    "3. Đọc nội dung file:",
    "### READ_FILES:",
    "FILES: <tên file 1, tên file 2...>",
    "REASON: <lý do đọc>",
    "",
    "4. Cập nhật Ghi nhớ Phong cách:",
    "### UPDATE_THEME_MEMORY:",
    "MEMORY_UPDATE: <Tóm tắt những quy ước UI/UX bạn vừa chốt để ghi nhớ vào THEME.md cho các vòng lặp sau>",
    "",
    "5. Dùng Kỹ năng Đặc biệt (Skill):",
    "### USE_SKILL: <tên skill>",
    "(Khi gọi, hệ thống sẽ trả về Bí kíp chi tiết để bạn học hỏi áp dụng ngay vào code.)",
    "DANH SÁCH SKILL BẠN CÓ THỂ GỌI:"
  ];

  if (availableSkills.length > 0) {
    for (const skill of availableSkills) {
      toolsModule.push(`- ${skill.slug}: ${skill.description}`);
    }
  } else {
    toolsModule.push("- (Hiện chưa có skill nào)");
  }

  toolsModule.push(
    "",
    "6. Tra cứu hệ thống thiết kế (Design System):",
    "### GET_DESIGN_SYSTEM:",
    "QUERY: <từ khoá tiếng Anh, vd: fashion pastel elegant>",
    "",
    "7. Chia nhỏ việc và Hoàn thành một chặng (Sub-task):",
    "### FINISH_SUBTASK:",
    "SUMMARY: <tóm tắt việc vừa làm xong>",
    "NEXT_TASK: <việc tiếp theo cần làm>",
    "(XÓA TRẮNG bộ nhớ các file đang mở để giải phóng Context. Dùng khi vừa xong 1 chặng).",
    "",
    "8. Xem Hợp đồng giao diện của các Plugin đang kích hoạt:",
    "### GET_PLUGIN_CONTRACTS:",
    "(Không cần tham số, trả về danh sách các thẻ {% render %} mà Plugin yêu cầu chèn vào Theme. Gọi tool này khi User yêu cầu chèn code Plugin hoặc sửa giao diện Plugin)",
    "",
    "9. Trả lời User (Dừng vòng lặp và hoàn toàn kết thúc):",
    "### REPLY_TO_USER:",
    "<Câu trả lời báo cáo tổng hợp sau khi ĐÃ XONG TẤT CẢ các Subtask>",
    "- LƯU Ý: Lời nhắn cho User phải NGẮN GỌN, DỄ HIỂU, tập trung vào kết quả kinh doanh/giao diện.",
    "- TUYỆT ĐỐI HẠN CHẾ DÙNG THUẬT NGỮ CHUYÊN NGÀNH kỹ thuật (như js, css, liquid, DOM, div, v.v.)."
  );

  promptParts.push(toolsModule.join("\n"));

  // [MODULE 3: QUY ƯỚC CODE LIQUID VÀ BẢO VỆ HỢP ĐỒNG - Chỉ gửi khi có file mở]
  if (hasOpenFiles) {
    const liquidConvention = [
      "# 4. QUY ƯỚC CODE LIQUID CHO HỆ THỐNG NÀY",
      "- Sử dụng lệnh `{% render 'components/product/card', product: item %}` để nhúng Component con.",
      "- Không tự bịa ra đường dẫn Component. Dùng LIST_FILES để tra đường dẫn chuẩn.",
      "- Vòng lặp dùng `{% for item in array %}`, in biến dùng `{{ variable }}`.",
      ""
    ];

    liquidConvention.push(
      "LƯU Ý QUAN TRỌNG VỀ REPLACE_CODE VÀ OVERWRITE_FILE (CHỈ SỬ DỤNG KHI CẦN SỬA FILE):",
      "### REPLACE_CODE: <tên file>",
      "AI_NOTES: <Tóm tắt thay đổi hoặc lưu ý cho lần sửa sau để AI khác hiểu, ghi 1 dòng ngắn gọn>",
      "<<<< ORIGINAL",
      "<đoạn code gốc cần thay thế, PHẢI CHÍNH XÁC TỪNG KÝ TỰ, KHOẢNG TRẮNG, XUỐNG DÒNG>",
      "====",
      "<đoạn code mới>",
      ">>>>",
      "- CÓ THỂ ĐỊNH NGHĨA NHIỀU CẶP <<<< ORIGINAL ... >>>> LIÊN TIẾP NẾU MUỐN SỬA NHIỀU ĐOẠN KHÁC NHAU.",
      "",
      "NẾU MUỐN GHI ĐÈ TOÀN BỘ FILE (thay vì tìm và thay thế), SỬ DỤNG TOOL SAU:",
      "### OVERWRITE_FILE: <tên file>",
      "AI_NOTES: <Tóm tắt thay đổi hoặc lưu ý cho lần sửa sau để AI khác hiểu, ghi 1 dòng ngắn gọn>",
      "====",
      "<toàn bộ nội dung mới của file>",
      "====",
      "- BẠN KHÔNG ĐƯỢC TRẢ VỀ KHỐI {% comment %} Ở ĐẦU FILE TRONG MÃ NGUỒN LIQUID. Hệ thống sẽ tự động cập nhật AI_NOTES vào khối comment đó.",
      "- Không output REPLACE_CODE hay OVERWRITE_FILE vào trong khối `### THOUGHT`."
    );

    promptParts.push(liquidConvention.join("\n"));
  }

  // [MODULE 4: LUẬT REDESIGN - Chỉ gửi khi ở chế độ Redesign]
  if (isRedesign) {
    promptParts.push(
      "# 5. CẢNH BÁO REDESIGN MODE (THIẾT KẾ LẠI TOÀN BỘ)",
      "- BẮT BUỘC tuân thủ 4 bước của CHÍNH SÁCH THIẾT KẾ ở trên.",
      "- NẾU ĐÃ ĐƯỢC DUYỆT PHONG CÁCH, bắt đầu code:",
      "  - File .liquid hiện tại sẽ tự động được hệ thống quản lý khối {% comment %} bảo vệ hợp đồng.",
      "  - Dùng REPLACE_CODE hoặc OVERWRITE_FILE thay toàn bộ code thành TOÀN BỘ CODE MỚI của bạn (không bao gồm {% comment %} hợp đồng).",
      "- Viết HTML/CSS/JS thật đầy đủ, chi tiết, thẩm mỹ cao."
    );
  }

  // [MODULE 5: FORMAT OUTPUT]
  promptParts.push(
    "===========================================================",
    "# 6. FORMAT OUTPUT DUY NHẤT HỢP LỆ CHO BẠN TRONG MỌI HOÀN CẢNH:",
    "### THOUGHT:",
    "Tôi cần đọc file layout.liquid để xem nội dung.",
    "### READ_FILES:",
    "FILES: layout.liquid",
    "REASON: Xem nội dung hiện tại",
    "==========================================================="
  );

  return promptParts.join("\n\n");
}

export function buildAgentUserPrompt(
  themeMd: string,
  message: string,
  history: ChatHistoryItem[],
  contextFiles: Record<string, string>,
  observations: string[],
  completedSubtasks: string[],
  hasImage: boolean,
): string {
  const filesBlock = Object.entries(contextFiles)
    .map(([file, content]) => `--- File đã mở: ${file} ---\n${content}`)
    .join("\n\n");

  const obsBlock = observations.length
    ? ["\n--- KẾT QUẢ CỦA CÁC TOOL VỪA GỌI Ở CHẶNG NÀY (OBSERVATIONS) ---", ...observations, ""]
    : [];

  const subtaskBlock = completedSubtasks.length
    ? ["\n--- CÁC VIỆC ĐÃ LÀM XONG TRƯỚC ĐÓ ---", ...completedSubtasks.map((t, i) => `${i + 1}. ${t}`), ""]
    : [];

  return [
    "Trí nhớ theme hiện tại (THEME.md):",
    "```markdown",
    themeMd,
    "```",
    "",
    "--- LỊCH SỬ CHAT TRƯỚC ĐÓ ---",
    formatHistory(history),
    "",
    `YÊU CẦU TỪ ADMIN: ${message}`,
    ...(hasImage ? ["(Admin có đính kèm 1 ảnh tham khảo)"] : []),
    "",
    ...subtaskBlock,
    filesBlock,
    ...obsBlock,
    "",
    "VUI LÒNG BẮT ĐẦU BẰNG ### THOUGHT: ĐỂ SUY LUẬN BƯỚC TIẾP THEO."
  ].join("\n");
}

export function parseAgentResponse(raw: string): AgentAction[] {
  const actions: AgentAction[] = [];

  const replaceRegex = /### REPLACE_CODE:\s*(.+?)\n(?:AI_NOTES:\s*(.+?)\n)?([\s\S]*?)(?=\n### |$)/g;
  let replaceMatch;
  while ((replaceMatch = replaceRegex.exec(raw)) !== null) {
    const file = replaceMatch[1].trim();
    const aiNotes = replaceMatch[2] ? replaceMatch[2].trim() : undefined;
    const blocksStr = replaceMatch[3];
    const blocks: ReplaceBlock[] = [];
    const blockRegex = /<<<< ORIGINAL\n([\s\S]*?)\n====\n([\s\S]*?)\n>>>>/g;
    let bMatch;
    while ((bMatch = blockRegex.exec(blocksStr)) !== null) {
      blocks.push({ original: bMatch[1], replacement: bMatch[2] });
    }
    if (blocks.length > 0) {
      actions.push({ type: "REPLACE_CODE", payload: { file, blocks, aiNotes } });
    }
  }

  const overwriteRegex = /### OVERWRITE_FILE:\s*(.+?)\n(?:AI_NOTES:\s*(.+?)\n)?====\n([\s\S]*?)(?=\n====|\n### |$)/g;
  let overwriteMatch;
  while ((overwriteMatch = overwriteRegex.exec(raw)) !== null) {
    const file = overwriteMatch[1].trim();
    const aiNotes = overwriteMatch[2] ? overwriteMatch[2].trim() : undefined;
    const content = overwriteMatch[3];
    actions.push({ type: "OVERWRITE_FILE", payload: { file, content, aiNotes } });
  }

  const searchMatch = raw.match(/### SEARCH_CODE:\s*\nQUERY:\s*(.*?)\nREASON:\s*(.*?)(?=\n###|$)/s);
  if (searchMatch) {
    actions.push({ type: "SEARCH_CODE", payload: { query: searchMatch[1].trim(), reason: searchMatch[2].trim() } });
  }

  const listFilesMatch = raw.match(/### LIST_FILES:(?=\n###|$)/);
  if (listFilesMatch) {
    actions.push({ type: "LIST_FILES", payload: {} });
  }

  const getContractsMatch = raw.match(/### GET_PLUGIN_CONTRACTS:(?=\n###|$)/);
  if (getContractsMatch) {
    actions.push({ type: "GET_PLUGIN_CONTRACTS", payload: {} });
  }

  const finishMatch = raw.match(/### FINISH_SUBTASK:\s*\nSUMMARY:\s*(.*?)\nNEXT_TASK:\s*(.*?)(?=\n###|$)/s);
  if (finishMatch) {
    actions.push({ type: "FINISH_SUBTASK", payload: { summary: finishMatch[1].trim(), nextTask: finishMatch[2].trim() } });
  }

  const useSkillMatch = raw.match(/### USE_SKILL:\s*(.*?)(?=\n###|$)/);
  if (useSkillMatch) {
    actions.push({ type: "USE_SKILL", payload: { skill: useSkillMatch[1].trim() } });
  }

  const readMatch = raw.match(/### READ_FILES:\s*\nFILES:\s*(.*?)\nREASON:\s*(.*?)(?=\n###|$)/s);
  if (readMatch) {
    const files = readMatch[1].split(",").map(f => f.trim()).filter(Boolean);
    actions.push({ type: "READ_FILES", payload: { files, reason: readMatch[2].trim() } });
  }

  const replyMatch = raw.match(/### REPLY_TO_USER:\s*([\s\S]*?)(?=\n###|$)/);
  if (replyMatch) {
    actions.push({ type: "REPLY_TO_USER", payload: { message: replyMatch[1].trim() } });
  }
  
  const memoryMatch = raw.match(/### UPDATE_THEME_MEMORY:\s*([\s\S]*?)(?=\n###|$)/);
  if (memoryMatch) {
    actions.push({ type: "UPDATE_THEME_MEMORY", payload: { memoryUpdate: memoryMatch[1].trim() } });
  }

  const designMatch = raw.match(/### GET_DESIGN_SYSTEM:\s*\nQUERY:\s*(.*?)(?=\n###|$)/);
  if (designMatch) {
    actions.push({ type: "GET_DESIGN_SYSTEM", payload: { styleQuery: designMatch[1].trim() } });
  }

  return actions;
}

export function applyReplacements(content: string, blocks: ReplaceBlock[]): { success: boolean; newContent: string; errors: string[] } {
  let newContent = content;
  const errors: string[] = [];
  
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (newContent.includes(block.original)) {
      newContent = newContent.replace(block.original, block.replacement);
    } else {
      const normContent = newContent.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n');
      const normOrig = block.original.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd()).join('\n');
      if (normContent.includes(normOrig)) {
        newContent = normContent.replace(normOrig, block.replacement.replace(/\r\n/g, '\n'));
      } else {
        errors.push(`[Block ${i + 1}] Không tìm thấy chính xác đoạn ORIGINAL trong file.`);
      }
    }
  }
  return { success: errors.length === 0, newContent, errors };
}

export async function callAiAgent(
  agent: Agent,
  systemPrompt: string,
  userPrompt: string,
  imageUrl?: string,
): Promise<string> {
  return callAgent(agent, systemPrompt, userPrompt, imageUrl);
}

async function buildRetrySystemPrompt(slug: string, file: string): Promise<string> {
  const contract = await getContractFromDisk(slug, file);
  const intro = "Bạn là chuyên gia Liquid + Tailwind CSS/JS, đang sửa lại 1 file bị lỗi Hợp đồng (Contract) sau khi Replace.";
  if (!contract) {
    return [intro, "Trả về TOÀN BỘ nội dung file mới đã sửa đúng lỗi (KHÔNG DÙNG REPLACE NỮA, IN RA TOÀN BỘ FILE).", "Bắt đầu bằng ### FILE: <tên file>"].join("\n");
  }
  return [
    intro,
    `File "${file}" (${contract.description}) đang vi phạm hợp đồng bắt buộc — sửa ĐÚNG các lỗi được liệt kê, giữ nguyên phần còn lại:`,
    ...contract.requiredSubstrings.map((s: string) => `- Phải giữ nguyên văn chuỗi/thẻ: ${s}`),
    ...contract.requiredIds.map((id: string) => `- Phải có phần tử HTML với id="${id}"`),
    "Trả về TOÀN BỘ nội dung file mới đã sửa đúng lỗi (KHÔNG DÙNG REPLACE NỮA, IN RA TOÀN BỘ FILE), không giải thích.",
    "Bắt đầu bằng ### FILE: <tên file>"
  ].join("\n");
}

function buildRetryUserPrompt(currentContent: string, errors: string[]): string {
  return [
    "Bản vừa thay thế bị lỗi, PHẢI sửa lại và trả về TOÀN BỘ file (dùng thẻ ### FILE:):",
    ...errors.map((e) => `- ${e}`),
    "",
    "Bản vừa sinh (có lỗi ở trên):",
    currentContent,
  ].join("\n");
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

export async function retryUntilValid(slug: string, agent: Agent, file: string, firstContent: string, firstErrors: string[]): Promise<{ok: boolean, content?: string, errors: string[]}> {
  let currentContent = firstContent;
  let currentErrors = firstErrors;

  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callAgent(agent, await buildRetrySystemPrompt(slug, file), buildRetryUserPrompt(currentContent, currentErrors));
    
    const fileMatch = raw.match(/### FILE:\s*(.*?)\n([\s\S]*)$/);
    if (!fileMatch) {
      currentErrors.push("AI không trả về định dạng ### FILE trong lúc Retry.");
      continue;
    }
    
    const newContent = stripCodeFence(fileMatch[2].trim());
    const validation = await validateThemeFile(slug, file, newContent);

    if (validation.ok) {
      return { ok: true, content: newContent, errors: [] };
    }

    const stuck = validation.errors.length === currentErrors.length && validation.errors.every((e, i) => e === currentErrors[i]);
    currentContent = newContent;
    currentErrors = validation.errors;
    if (stuck) break;
  }

  return { ok: false, errors: currentErrors };
}
