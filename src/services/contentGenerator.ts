import type { Agent } from "@prisma/client";
import { callAgent } from "./aiClient.js";
import { sanitizePostBody } from "./sanitizeHtml.js";

export interface GeneratedPostContent {
  title: string;
  excerpt: string;
  body: string;
}

// Danh sach the HTML duoc phep - PHAI khop dung ALLOWED_TAGS trong sanitizeHtml.ts, chi de nhet
// vao prompt cho AI biet gioi han, khong phai nguon that (nguon that van la sanitizePostBody()
// chay lai sau khi AI tra loi - khong tin tuyet doi AI tuan thu dung prompt).
const ALLOWED_TAGS_HINT =
  "p, br, hr, strong, em, u, s, blockquote, pre, code, h2, h3, h4, ul, ol, li, a, img, figure, figcaption, table, thead, tbody, tr, th, td, span, div";

function buildGenerateSystemPrompt(): string {
  return [
    "Bạn là trợ lý viết nội dung blog tiếng Việt, giọng văn tự nhiên, không lan man, không bịa số liệu/cam kết cụ thể.",
    `Phần NỘI_DUNG phải là HTML hợp lệ, CHỈ dùng các thẻ: ${ALLOWED_TAGS_HINT}. Không dùng <script>, <style>, <iframe>, thuộc tính onXxx, hay URL javascript:.`,
    "Trả lời ĐÚNG định dạng sau, không thêm lời dẫn/giải thích, không dùng markdown code fence:",
    "TIÊU_ĐỀ: <tiêu đề bài viết, 1 dòng>",
    "TÓM_TẮT: <tóm tắt ngắn 1-2 câu>",
    "NỘI_DUNG:",
    "<toàn bộ nội dung HTML, có thể nhiều dòng>",
  ].join("\n");
}

function parseGeneratedContent(raw: string): GeneratedPostContent {
  const titleMatch = raw.match(/TIÊU_ĐỀ:\s*(.+)/);
  const excerptMatch = raw.match(/TÓM_TẮT:\s*(.+)/);
  const bodyMatch = raw.match(/NỘI_DUNG:\s*([\s\S]*)$/);

  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    excerpt: excerptMatch ? excerptMatch[1].trim() : "",
    body: bodyMatch ? sanitizePostBody(bodyMatch[1].trim()) : "",
  };
}

// Sinh bai viet MOI tu 1 chu de/y tuong ngan - dung agent purpose='content' (routes/admin/postsAi.ts
// resolve). Ket qua CHUA duoc luu, tra ve de admin xem/sua trong form truoc khi bam Luu that.
export async function generatePostContent(agent: Agent, topic: string): Promise<GeneratedPostContent> {
  const raw = await callAgent(agent, buildGenerateSystemPrompt(), `Chủ đề/ý tưởng: ${topic}`);
  return parseGeneratedContent(raw);
}

// Viet lai/cai thien noi dung ĐANG CÓ theo 1 chi dan tu do (vd "rút gọn", "giọng trang trọng hơn").
// Nhan HTML, tra HTML - luon sanitizePostBody() lai truoc khi tra ve (khong tin AI tuan thu dung
// allowlist, giong het cach body duoc sanitize luc luu that trong routes/admin/posts.ts).
export async function rewritePostContent(agent: Agent, currentBodyHtml: string, instruction: string): Promise<string> {
  const systemPrompt = [
    "Bạn là trợ lý biên tập nội dung blog tiếng Việt.",
    `Trả lời CHỈ bằng HTML hợp lệ (không thêm giải thích, không markdown code fence), CHỈ dùng các thẻ: ${ALLOWED_TAGS_HINT}.`,
  ].join("\n");
  const userPrompt = [`Yêu cầu chỉnh sửa: ${instruction}`, "", "Nội dung hiện tại (HTML):", currentBodyHtml].join("\n");

  const raw = await callAgent(agent, systemPrompt, userPrompt);
  return sanitizePostBody(raw.trim());
}
