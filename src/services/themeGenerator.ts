import type { Agent } from "@prisma/client";
import { callAgent } from "./aiClient.js";
import { getContract, ThemeFileContract, ThemeAssetFile } from "./themeContract.js";
import { validateThemeFile } from "./themeValidator.js";

const MAX_ATTEMPTS = 3;

export interface GenerateFileResult {
  file: string;
  ok: boolean;
  content?: string;
  errors: string[];
  attempts: number;
}

function buildSystemPrompt(contract: ThemeFileContract): string {
  return [
    "Bạn là chuyên gia thiết kế giao diện web, viết template Liquid (LiquidJS) + Tailwind CSS (qua CDN, đã nạp sẵn ở layout.liquid, KHÔNG cần thêm <script>/<link> Tailwind trong file này trừ khi đây chính là layout.liquid).",
    `Nhiệm vụ: viết LẠI TOÀN BỘ nội dung file "${contract.file}" — ${contract.description}`,
    "",
    "BẮT BUỘC tuân thủ (nếu vi phạm, hệ thống sẽ tự động từ chối và bắt bạn sửa lại):",
    ...contract.requiredSubstrings.map((s) => `- Phải giữ nguyên văn chuỗi/thẻ: ${s}`),
    ...contract.requiredIds.map((id) => `- Phải có phần tử HTML với id="${id}"`),
    "",
    "Ghi chú ngữ cảnh: " + contract.notes,
    "",
    "Chỉ trả về NGUYÊN VĂN nội dung file (không giải thích, không markdown code fence, không lời dẫn trước/sau).",
  ].join("\n");
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

// Sinh 1 file theme: goi AI -> validate (services/themeValidator.ts) -> neu fail, goi lai kem
// DANH SACH LOI cu the de AI tu sua (khong phai lam lai tu dau voi prompt y het) -> toi da
// MAX_ATTEMPTS lan. Tra ve ok=false + content cuoi cung (de admin xem AI sinh gi ma van sai) neu
// het luot van khong dat.
export async function generateThemeFile(
  agent: Agent,
  file: string,
  referenceContent: string,
  stylePrompt: string,
): Promise<GenerateFileResult> {
  const contract = getContract(file);
  if (!contract) {
    return { file, ok: false, errors: [`Không có hợp đồng cho file "${file}"`], attempts: 0 };
  }

  const systemPrompt = buildSystemPrompt(contract);
  let userPrompt = [
    `Phong cách mong muốn (mô tả của người dùng): ${stylePrompt}`,
    "",
    "File tham khảo (theme gốc — giữ đúng các biến/id bắt buộc, được đổi tự do phần trình bày/HTML/class):",
    "```liquid",
    referenceContent,
    "```",
  ].join("\n");

  let lastErrors: string[] = [];
  let lastContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callAgent(agent, systemPrompt, userPrompt);
    const content = stripCodeFence(raw);
    lastContent = content;

    const result = await validateThemeFile(file, content);
    if (result.ok) {
      return { file, ok: true, content, errors: [], attempts: attempt };
    }

    lastErrors = result.errors;
    userPrompt = [
      `Bản bạn vừa sinh cho file "${file}" bị lỗi, PHẢI sửa lại và trả về TOÀN BỘ file (không chỉ đoạn sửa):`,
      ...result.errors.map((e) => `- ${e}`),
      "",
      "Bản vừa sinh (có lỗi ở trên):",
      "```liquid",
      content,
      "```",
    ].join("\n");
  }

  return { file, ok: false, content: lastContent, errors: lastErrors, attempts: MAX_ATTEMPTS };
}

// Sinh CSS/JS tuy bien — KHONG qua validator Liquid (khong phai file Liquid), chi 1 lan goi (khong
// retry vi khong co "loi" ro rang de bao AI sua, sai thi admin tu sinh lai tay). Loi mang/API van
// nem ra ngoai binh thuong (route goi ham nay tu bat).
export async function generateAssetFile(
  agent: Agent,
  asset: ThemeAssetFile,
  referenceContent: string,
  stylePrompt: string,
): Promise<string> {
  const systemPrompt = [
    `Bạn viết ${asset.contentType.toUpperCase()} thuần (không phải Liquid) cho 1 theme website.`,
    `File: ${asset.file}. ${asset.notes}`,
    "Chỉ trả về NGUYÊN VĂN nội dung file (không giải thích, không markdown code fence, không lời dẫn trước/sau).",
  ].join("\n");

  const userPrompt = [
    `Phong cách mong muốn: ${stylePrompt}`,
    "",
    "Nội dung hiện tại (có thể rỗng nếu chưa từng có) — sửa/viết lại theo phong cách trên:",
    "```",
    referenceContent,
    "```",
  ].join("\n");

  const raw = await callAgent(agent, systemPrompt, userPrompt);
  return stripCodeFence(raw);
}
