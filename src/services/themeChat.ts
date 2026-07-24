import type { Agent } from "@prisma/client";
import { callAgent } from "./aiClient.js";
import { getContract, THEME_ASSET_FILES } from "./themeContract.js";
import { validateThemeFile } from "./themeValidator.js";

const RECENT_HISTORY_LIMIT = 3;
// Toi da 3 lan thu (1 lan dau + 2 lan sua lai) cho 1 file neu validate that bai - khop quy uoc cu
// cua themeGenerator.ts (da xoa) khi chuyen sang kien truc chat.
const MAX_ATTEMPTS = 3;

export interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export type ClassifyMode = "chat" | "edit" | "redesign";

export interface ClassifyResult {
  mode: ClassifyMode;
  files: string[];
  reply: string;
  intentUpdate: string | null;
  // Chi co gia tri khi mode la "redesign" - brief day du (phong cach + tinh nang giu/them/bot) AI
  // tong hop tu ca cuoc hoi thoai, dung thay cho "message" khi goi editThemeFiles cho ca 18 trang.
  redesignBrief: string | null;
  // Di kem redesignBrief - vai tu khoa TIENG ANH (kho du lieu UI/UX trong uiuxSearch.ts toan
  // tieng Anh, dua thang brief tieng Viet vao se ra ket qua sai - xem test thu voi query VN).
  styleQuery: string | null;
}

export interface EditFileResult {
  file: string;
  ok: boolean;
  // true = AI xet thay file nay khong can doi gi (khac voi ok=false: that su co loi/validate fail).
  skipped?: boolean;
  content?: string;
  errors: string[];
  attempts?: number;
}

export interface EditResult {
  files: EditFileResult[];
  memoryUpdate: string | null;
  needsMoreFiles: {
    files: string[];
    task: string;
    reason: string | null;
  } | null;
  // Cau ngan, khong thuat ngu, mo ta NHOM NAY vua doi gi - null neu khong co gi thuc su thay doi
  // (moi file skipped/that bai). Dung de nhom sau (hoac nhom cuoi tong hop SUMMARY) biet nhom nay
  // da lam gi ma khong can doc lai toan bo noi dung file.
  changeNote: string | null;
  // Chi co gia tri khi day la nhom CUOI CUNG trong luot chat (isLastGroup=true) va AI thuc su viet
  // ra - 1-2 cau tong hop TOAN BO cac CHANGE_NOTE cua cac nhom truoc + viec nhom nay vua lam, cho
  // dung van phong de hieu. null neu khong phai nhom cuoi, hoac AI quen khong viet (server se tu
  // ghep tom tat co hoc lam phuong an du phong - xem routes/admin/themeChat.ts).
  summary: string | null;
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
    "Bạn là trợ lý AI chỉnh sửa theme website (Liquid + Tailwind), chat với admin. Đây là LẦN PHÂN LOẠI — chưa sửa file.",
    "",
    "Trả lời ĐÚNG định dạng, không giải thích, không code fence:",
    "MODE: chat, edit, hoặc redesign",
    "FILES: <file cần sửa, cách nhau bởi dấu phẩy, để trống nếu chat/redesign. Chọn file chính liên quan nhất; server sẽ tự mở kèm cùng nhóm .liquid/.css/.js để bạn tách markup, style và script đúng chỗ.>",
    "REPLY: <1-3 câu, văn phong xem bên dưới>",
    "INTENT_UPDATE: <CHỈ khi admin nêu quy ước TOÀN SITE, ít đổi (màu chủ đạo, font, phong cách chung) thì ghi lại TOÀN BỘ quy " +
      "ước đã biết tới giờ; để trống nếu không có gì mới. KHÔNG ghi hành vi riêng của 1 tính năng/trang (thuộc về code).>",
    "REDESIGN_BRIEF: <điền khi ĐANG Ở BƯỚC ĐỀ XUẤT thiết kế lại toàn site (MODE vẫn là chat) HOẶC khi MODE là redesign — " +
      "brief đầy đủ, tổng hợp từ toàn bộ hội thoại: phong cách/giao diện muốn + tính năng giữ nguyên/thêm/bớt. Để trống ở " +
      "mọi trường hợp khác.>",
    "STYLE_QUERY: <CHỈ điền cùng lúc với REDESIGN_BRIEF — vài từ khoá TIẾNG ANH (không phải câu, không dấu) mô tả " +
      "ngành hàng + phong cách mong muốn, dùng để tra kho dữ liệu UI/UX (vd 'fashion apparel ecommerce pastel feminine " +
      "modern', 'b2b saas dashboard professional dark'). Để trống ở mọi trường hợp khác.>",
    "",
    "QUY TẮC:",
    "- edit CHỈ khi đã rõ sửa GÌ và Ở FILE NÀO. Còn mơ hồ về VỊ TRÍ/CẤU TRÚC thì trả chat và hỏi lại — không đoán.",
    "- KHÔNG hỏi lại về GU THẨM MỸ (màu/font/phong cách) — tự quyết theo 'Quy ước & gu thẩm mỹ chung' trong THEME.md.",
    "- FILES chỉ liệt kê file CÓ CĂN CỨ, không chọn dư phòng hờ. Nếu chọn 1 file trong nhóm trang/component, server tự mở thêm cùng nhóm .liquid/.css/.js.",
    "- Các trang nội dung (home/blog-post/page/product-detail/...) render bên trong layout.liquid, KHÔNG tự có " +
      "bố cục riêng (max-width, khoảng lề...). Đổi bố cục TOÀN SITE thì chỉ cần chọn layout.liquid (+ header/" +
      "footer nếu chúng tự có wrapper riêng) — không chọn thêm trang nội dung nào khác.",
    "- Cần CSS/JS riêng (Tailwind không làm được) thì viết vào file nguồn .css/.js được server gửi kèm ở bước sửa — không nhúng " +
      "<style>/<script> vào .liquid.",
    "",
    "BẢN ĐỒ CHỌN FILE CHO TRANG SẢN PHẨM:",
    "- Sắp xếp/vị trí các khối lớn của trang chi tiết sản phẩm: product-detail.liquid.",
    "- Ảnh/gallery/fallback ảnh sản phẩm: components/product/media.liquid.",
    "- Tên, danh mục, thông tin nhận diện/ngắn của sản phẩm: components/product/info.liquid.",
    "- Giá, biến thể, tồn kho, thêm giỏ, mua ngay, form mua ngay: components/product/purchase.liquid.",
    "- Mô tả dài, thông số, FAQ, custom fields, đánh giá/list review/form review: components/product/content.liquid.",
    "- Upsell/cross-sell/cụm sản phẩm liên quan trong trang chi tiết: components/product/related.liquid.",
    "- Card sản phẩm xuất hiện ở trang chủ, danh sách, danh mục, tìm kiếm, related: components/product/card.liquid.",
    "- Nếu admin nói 'card sản phẩm ở category/home/related/search' thì chọn components/product/card.liquid, không chọn product-detail.liquid.",
    "",
    "QUY TẮC RIÊNG cho THIẾT KẾ LẠI TOÀN SITE (theme còn trống hoàn toàn — 'Đã áp dụng' là '(chưa có)' — hoặc admin yêu cầu " +
      "'thiết kế lại/làm mới toàn bộ giao diện'): việc này SỬA CẢ 18 TRANG, rủi ro cao, đi qua 3 bước bắt buộc:",
    "  1) Hỏi đủ 2 điều nếu chưa rõ: phong cách/giao diện muốn ra sao, và giữ nguyên tính năng hiện có hay muốn thêm/bớt gì " +
      "(MODE: chat, để trống REDESIGN_BRIEF).",
    "  2) Khi đã đủ, KHÔNG làm ngay — tóm tắt lại kế hoạch trong REPLY và hỏi xác nhận, đồng thời điền REDESIGN_BRIEF (MODE " +
      "vẫn là chat).",
    "  3) CHỈ trả MODE: redesign (kèm REDESIGN_BRIEF) ở đúng lượt NGAY SAU KHI admin xác nhận đồng ý với bản tóm tắt bạn " +
      "vừa đưa ở lượt trước — nếu không chắc admin đang xác nhận đúng đề xuất đó thì vẫn hỏi lại (MODE: chat), TUYỆT ĐỐI " +
      "không tự suy diễn.",
    "",
    "VĂN PHONG cho REPLY (người đọc là chủ shop, không phải lập trình viên):",
    "- Không thuật ngữ kỹ thuật (tên file/class/id/thẻ HTML). Mô tả theo cái NHÌN THẤY (vị trí, màu, cảm giác " +
      "bấm/hover) — vd 'thu hẹp khung nội dung' thay vì 'sửa max-width trong layout.liquid'.",
    "- Hỏi lại bằng câu đời thường (vd 'hiện ở đầu trang hay chỉ trang chủ?'), không hỏi theo cấu trúc kỹ thuật.",
  ].join("\n");
}

function buildClassifyUserPrompt(themeMd: string, history: ChatHistoryItem[], message: string, hasImage: boolean): string {
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
    ...(hasImage ? ["Admin có đính kèm 1 ảnh tham khảo cho yêu cầu này — xem ảnh để hiểu rõ ý muốn (màu sắc, bố cục, phong cách)."] : []),
  ].join("\n");
}

function parseClassify(raw: string): ClassifyResult {
  const modeMatch = raw.match(/MODE:[ \t]*(chat|edit|redesign)/i);
  const filesMatch = raw.match(/FILES:[ \t]*(.*)/);
  const replyMatch = raw.match(/REPLY:\s*([\s\S]*?)(?:\nINTENT_UPDATE:|\nREDESIGN_BRIEF:|$)/);
  const intentMatch = raw.match(/INTENT_UPDATE:\s*([\s\S]*?)(?:\nREDESIGN_BRIEF:|$)/);
  const redesignMatch = raw.match(/REDESIGN_BRIEF:\s*([\s\S]*?)(?:\nSTYLE_QUERY:|$)/);
  const styleQueryMatch = raw.match(/STYLE_QUERY:\s*([\s\S]*)$/);

  const modeRaw = modeMatch?.[1]?.toLowerCase();
  const mode: ClassifyMode = modeRaw === "edit" || modeRaw === "redesign" ? modeRaw : "chat";
  const files = (filesMatch?.[1] ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const reply = replyMatch ? replyMatch[1].trim() : raw.trim();
  const intentRaw = intentMatch ? intentMatch[1].trim() : "";
  const intentUpdate = intentRaw.length ? intentRaw : null;
  const redesignRaw = redesignMatch ? redesignMatch[1].trim() : "";
  const redesignBrief = redesignRaw.length ? redesignRaw : null;
  const styleQueryRaw = styleQueryMatch ? styleQueryMatch[1].trim() : "";
  const styleQuery = styleQueryRaw.length ? styleQueryRaw : null;

  return { mode, files, reply, intentUpdate, redesignBrief, styleQuery };
}

export async function classifyChatMessage(
  agent: Agent,
  themeMd: string,
  history: ChatHistoryItem[],
  message: string,
  imageUrl?: string,
): Promise<ClassifyResult> {
  const raw = await callAgent(
    agent,
    buildClassifySystemPrompt(),
    buildClassifyUserPrompt(themeMd, history, message, Boolean(imageUrl)),
    imageUrl,
  );
  return parseClassify(raw);
}

function buildRetrySystemPrompt(file: string): string {
  const contract = getContract(file);
  const intro = "Bạn là chuyên gia Liquid + Tailwind CSS/JS, đang sửa lại 1 file bị lỗi.";
  if (!contract) {
    return [intro, "Trả về TOÀN BỘ nội dung file mới đã sửa đúng lỗi, không giải thích, không markdown code fence."].join("\n");
  }
  return [
    intro,
    `File "${file}" (${contract.description}) đang vi phạm hợp đồng bắt buộc — sửa ĐÚNG các lỗi được liệt kê, giữ nguyên phần còn lại:`,
    ...contract.requiredSubstrings.map((s) => `- Phải giữ nguyên văn chuỗi/thẻ: ${s}`),
    ...contract.requiredIds.map((id) => `- Phải có phần tử HTML với id="${id}"`),
    "Trả về TOÀN BỘ nội dung file mới đã sửa đúng lỗi, không giải thích, không markdown code fence.",
  ].join("\n");
}

function buildRetryUserPrompt(currentContent: string, errors: string[]): string {
  return [
    "Bản vừa sinh bị lỗi, PHẢI sửa lại và trả về TOÀN BỘ file (không chỉ đoạn sửa):",
    ...errors.map((e) => `- ${e}`),
    "",
    "Bản vừa sinh (có lỗi ở trên):",
    currentContent,
  ].join("\n");
}

// Thu lai TOI DA MAX_ATTEMPTS lan neu file khong qua validate - gui dung loi cu the lan truoc de
// AI sua tiep (khong phai doan lai tu dau). Dung som neu 2 lan lien tiep tra ve DUNG Y HET 1 loi
// (AI bi ket, thu them cung vo ich).
async function retryUntilValid(agent: Agent, file: string, firstContent: string, firstErrors: string[]): Promise<EditFileResult> {
  let currentContent = firstContent;
  let currentErrors = firstErrors;

  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callAgent(agent, buildRetrySystemPrompt(file), buildRetryUserPrompt(currentContent, currentErrors));
    const newContent = stripCodeFence(raw);
    const validation = await validateThemeFile(file, newContent);

    if (validation.ok) {
      return { file, ok: true, content: newContent, errors: [], attempts: attempt };
    }

    const stuck = validation.errors.length === currentErrors.length && validation.errors.every((e, i) => e === currentErrors[i]);
    currentContent = newContent;
    currentErrors = validation.errors;
    if (stuck) break;
  }

  return { file, ok: false, errors: currentErrors, attempts: MAX_ATTEMPTS };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function buildEditSystemPrompt(files: string[], isLastGroup: boolean): string {
  const contractNotes = files
    .map((file) => {
      const contract = getContract(file);
      if (!contract) {
        const asset = THEME_ASSET_FILES.find((a) => a.file === file);
        if (asset) return `File "${file}": ${asset.notes}`;
        return `File "${file}": không có hợp đồng ràng buộc riêng.`;
      }
      return [
        `File "${file}" (${contract.description}):`,
        ...contract.requiredSubstrings.map((s) => `  - Phải giữ nguyên văn chuỗi/thẻ: ${s}`),
        ...contract.requiredIds.map((id) => `  - Phải có phần tử HTML với id="${id}"`),
        `  - Ghi chú: ${contract.notes}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Bạn là chuyên gia Liquid (LiquidJS) + Tailwind, sửa đúng các file dưới đây theo yêu cầu admin, giữ nguyên phần không liên quan.",
    "File .liquid: chỉ dùng class Tailwind có sẵn, KHÔNG nhúng <style>/<script> — CSS/JS riêng trang đã có 2 file .css/.js cùng tên bên dưới, viết vào đó.",
    "",
    "Hợp đồng từng file (bắt buộc, hệ thống tự kiểm tra):",
    contractNotes,
    "",
    "CRITICAL INSTRUCTION: Các mục trong hợp đồng trên là những CẤU TRÚC NÊN CÓ để hệ thống hoạt động. Tuy nhiên, YÊU CẦU CỦA NGƯỜI DÙNG (User) VẪN LÀ TIÊN QUYẾT. Bạn PHẢI thiết kế giao diện và thêm các chức năng nâng cao theo đúng yêu cầu, sở thích của người dùng, kết hợp với các cấu trúc nên có trên.",
    "",
    "Lưu ý CHUNG cho CHANGE_NOTE/SUMMARY/MEMORY_UPDATE bên dưới: chỉ mô tả những gì VỪA THỰC SỰ code xong (xem file ở trên) — " +
      "'Quy ước & gu thẩm mỹ chung' trong THEME.md là mục tiêu dài hạn, có thể CHƯA làm xong, KHÔNG được lấy nội dung từ đó.",
    "",
    "Trả lời ĐÚNG định dạng, không giải thích, không code fence:",
    "### FILE: <tên file>",
    "<toàn bộ nội dung mới>",
    "(lặp lại cho từng file THỰC SỰ SỬA — file nào không cần đổi thì bỏ qua hẳn, không trả khối FILE)",
    "",
    "### CHANGE_NOTE:",
    "<1 câu ngắn, không thuật ngữ kỹ thuật, mô tả cái vừa sửa (vd 'đổi màu nút mua hàng sang cam') — bỏ trống nếu không đổi gì.",
    "",
    "### NEED_MORE_FILES:",
    "FILES: <nếu không thấy chỗ sửa đúng yêu cầu trong các file đang mở, ghi file cần mở tiếp, cách nhau bằng dấu phẩy; để trống nếu không cần>",
    "REASON: <1 câu ngắn nói vì sao nhóm hiện tại không đúng/không đủ>",
    "TASK: <task cụ thể cho lần gọi tiếp theo, bám sát yêu cầu admin và nói rõ cần tìm/sửa gì trong file mới>",
    "(Chỉ dùng NEED_MORE_FILES khi thật sự không thể hoàn thành với nhóm file hiện tại. Server chỉ cho tối đa 2 lần mở thêm file trong một lượt chat.)",
    "",
    ...(isLastGroup
      ? [
          "Đây là NHÓM CUỐI của lượt chat. Thêm:",
          "### SUMMARY:",
          "<1-2 câu tổng hợp CẢ các nhóm trước (xem 'Các phần đã sửa trước đó') lẫn nhóm này, cùng văn phong CHANGE_NOTE — không liệt kê tên file.>",
          "",
        ]
      : []),
    "### MEMORY_UPDATE:",
    "<tóm tắt NGẮN GỌN hiện trạng đã code xong tới nay (không chỉ thay đổi vừa rồi) — mỗi file/phần 1 dòng, chỉ ghi SỰ KIỆN CHÍNH " +
      "(màu gì, có gì, làm gì), KHÔNG liệt kê chi tiết kỹ thuật.>",
  ].join("\n");
}

function buildEditUserPrompt(
  themeMd: string,
  message: string,
  classifiedReply: string,
  fileContents: Record<string, string>,
  priorChangeNotes: string[],
  hasImage: boolean,
  designSystemBlock?: string,
): string {
  const filesBlock = Object.entries(fileContents)
    .map(([file, content]) => `--- Nội dung hiện tại của ${file} ---\n${content}`)
    .join("\n\n");

  const priorNotesBlock = priorChangeNotes.length
    ? ["", "Các phần đã sửa trước đó trong lượt chat này:", ...priorChangeNotes.map((n) => `- ${n}`)]
    : [];

  return [
    "Trí nhớ phong cách của theme (trích từ THEME.md):",
    "```markdown",
    themeMd,
    "```",
    "",
    `Yêu cầu gốc của admin: ${message}`,
    `Bạn (ở bước phân loại trước đó) đã xác nhận với admin sẽ làm: ${classifiedReply}`,
    ...(hasImage ? ["Admin có đính kèm 1 ảnh tham khảo — bám sát ảnh khi viết code cho đúng màu sắc/bố cục/phong cách."] : []),
    ...(designSystemBlock
      ? [
          "",
          "Design system gợi ý (tra từ kho dữ liệu UI/UX theo đúng ngành hàng — DÙNG LÀM CĂN CỨ CHÍNH cho màu/font/phong cách, " +
            "trừ khi THEME.md hoặc ảnh tham khảo ở trên đã nói khác):",
          designSystemBlock,
        ]
      : []),
    ...priorNotesBlock,
    "",
    filesBlock,
  ].join("\n");
}

function parseEditResponse(
  raw: string,
  requestedFiles: string[],
): {
  fileContents: Record<string, string>;
  memoryUpdate: string | null;
  changeNote: string | null;
  summary: string | null;
  needsMoreFiles: { files: string[]; task: string; reason: string | null } | null;
} {
  const fileContents: Record<string, string> = {};
  const fileBlockRegex = /### FILE:\s*(.+?)\n([\s\S]*?)(?=\n### FILE:|\n### CHANGE_NOTE:|\n### NEED_MORE_FILES:|\n### SUMMARY:|\n### MEMORY_UPDATE:|$)/g;
  let match: RegExpExecArray | null;
  while ((match = fileBlockRegex.exec(raw)) !== null) {
    const file = match[1].trim();
    if (requestedFiles.includes(file)) {
      fileContents[file] = stripCodeFence(match[2].trim());
    }
  }

  const memoryMatch = raw.match(/### MEMORY_UPDATE:\s*([\s\S]*)$/);
  const memoryUpdate = memoryMatch ? memoryMatch[1].trim() : null;

  const changeNoteMatch = raw.match(/### CHANGE_NOTE:\s*([\s\S]*?)(?=\n### NEED_MORE_FILES:|\n### SUMMARY:|\n### MEMORY_UPDATE:|$)/);
  const changeNote = changeNoteMatch ? changeNoteMatch[1].trim() : null;

  const needMoreMatch = raw.match(/### NEED_MORE_FILES:\s*([\s\S]*?)(?=\n### SUMMARY:|\n### MEMORY_UPDATE:|$)/);
  let needsMoreFiles: { files: string[]; task: string; reason: string | null } | null = null;
  if (needMoreMatch) {
    const block = needMoreMatch[1];
    const filesLine = block.match(/FILES:\s*(.*)/)?.[1]?.trim() ?? "";
    const reasonMatch = block.match(/REASON:\s*([\s\S]*?)(?=\nTASK:|$)/);
    const taskMatch = block.match(/TASK:\s*([\s\S]*)$/);
    const files = filesLine
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    const task = taskMatch?.[1]?.trim() ?? "";
    const reason = reasonMatch?.[1]?.trim() || null;
    if (files.length && task) {
      needsMoreFiles = { files, task, reason };
    }
  }

  const summaryMatch = raw.match(/### SUMMARY:\s*([\s\S]*?)(?=\n### MEMORY_UPDATE:|$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : null;

  return {
    fileContents,
    memoryUpdate: memoryUpdate && memoryUpdate.length ? memoryUpdate : null,
    changeNote: changeNote && changeNote.length ? changeNote : null,
    summary: summary && summary.length ? summary : null,
    needsMoreFiles,
  };
}

// Lan goi 2: chi chay khi classify tra MODE=edit. Nhan noi dung THAT SU cua tung file (server da
// doc tu dia) de AI sua dua tren code that, khong doan mo. Sau khi AI tra ve, validate TUNG FILE
// qua themeValidator.ts — file loi thi GIU BAN GOC (khong ghi de), dam bao theme luon la 1 bo
// hoan chinh, khong bao gio nua vari du 1 vai file AI sua that bai.
export async function editThemeFiles(
  agent: Agent,
  themeMd: string,
  message: string,
  classifiedReply: string,
  fileContents: Record<string, string>,
  isLastGroup: boolean,
  priorChangeNotes: string[],
  imageUrl?: string,
  designSystemBlock?: string,
): Promise<EditResult> {
  const requestedFiles = Object.keys(fileContents);
  const raw = await callAgent(
    agent,
    buildEditSystemPrompt(requestedFiles, isLastGroup),
    buildEditUserPrompt(themeMd, message, classifiedReply, fileContents, priorChangeNotes, Boolean(imageUrl), designSystemBlock),
    imageUrl,
  );
  const { fileContents: newContents, memoryUpdate, changeNote, summary, needsMoreFiles } = parseEditResponse(raw, requestedFiles);

  const results: EditFileResult[] = [];
  for (const file of requestedFiles) {
    const newContent = newContents[file];
    if (!newContent) {
      // AI xet file nay khong can doi - khong phai loi, chi bo qua (xem huong dan trong
      // buildEditSystemPrompt: chi tra ### FILE cho file THUC SU sua).
      results.push({ file, ok: true, skipped: true, errors: [] });
      continue;
    }
    const contract = getContract(file);
    if (!contract) {
      // Asset CSS/JS - khong co hop dong Liquid de validate, chap nhan thang.
      results.push({ file, ok: true, content: newContent, errors: [] });
      continue;
    }
    const validation = await validateThemeFile(file, newContent);
    if (validation.ok) {
      results.push({ file, ok: true, content: newContent, errors: [], attempts: 1 });
      continue;
    }
    results.push(await retryUntilValid(agent, file, newContent, validation.errors));
  }

  const hasRealChange = results.some((r) => r.ok && !r.skipped);
  return {
    files: results,
    memoryUpdate: hasRealChange ? memoryUpdate : null,
    needsMoreFiles,
    changeNote: hasRealChange ? changeNote : null,
    summary: isLastGroup ? summary : null,
  };
}
