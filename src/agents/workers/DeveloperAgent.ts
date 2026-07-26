import { BaseAgent, AgentContext } from "../core/BaseAgent.js";

// Tool doc/ghi file (list_files/read_files/search_code/replace_code/overwrite_file) khong con
// dinh nghia rieng o day nua - da chuyen sang ToolRegistry (xem src/agents/tools/fileTools.ts)
// theo dung chuan MCP, BaseAgent.executeTool() tu tra ToolRegistry truoc khi fallback. Class nay
// gio chi con nhiem vu duy nhat: tuy bien system prompt theo ngu canh dang sua (Theme/Landing/Plugin).
export class DeveloperAgent extends BaseAgent {
  public allowedTools = ["list_files", "read_files", "search_code", "replace_code", "overwrite_file"];

  protected getSystemPrompt(context?: AgentContext): string {
    const isTheme = !!context?.meta?.themeSlug;
    const isLanding = !!context?.meta?.landingPageSlug;
    const isPlugin = !!context?.meta?.pluginSlug;

    let basePrompt = super.getSystemPrompt(context);
    basePrompt += `\n\nTHÔNG TIN HỆ THỐNG (NGỮ CẢNH ĐỘNG):\n`;

    if (isTheme) {
      basePrompt += `- Khung sườn (Framework): Bạn đang thao tác với mã nguồn của THEME sử dụng template engine **Liquid** (cú pháp giống Shopify).
- Bạn phải tuân thủ nghiêm ngặt cấu trúc khối {% comment %} bảo vệ hợp đồng ở đầu các file.
- Tuyệt đối không xóa logic Liquid khi sửa CSS.\n`;
    } else if (isLanding) {
      basePrompt += `- Khung sườn (Framework): Bạn đang thao tác với mã nguồn của LANDING PAGE.
- Môi trường tĩnh (HTML/TailwindCSS). Không có Liquid. Không cần bảo vệ {% comment %}.\n`;
    } else if (isPlugin) {
      basePrompt += `- Khung sườn (Framework): Bạn đang thao tác với mã nguồn của PLUGIN/ADDON.
- Cấu trúc thư mục addons/
- Hỗ trợ JS, CSS, Liquid.\n`;
    } else {
      basePrompt += `- Không xác định rõ ngữ cảnh (Theme/Landing/Plugin). Chỉ thực hiện thay thế cơ bản.\n`;
    }

    basePrompt += `
Khi đã làm xong, BẮT BUỘC dùng thẻ này để báo cáo lại kết quả cho Lễ tân hoặc Người dùng:
# REPLY_TO_USER
Nếu bạn vừa thực hiện THAY ĐỔI LỚN về giao diện/code, bạn BẮT BUỘC phải đính kèm dòng sau vào đầu câu trả lời để hệ thống tự động kiểm tra lỗi UI/UX (chỉ định đúng URL của trang liên quan):
QA_URL: <url_tương_ứng_của_trang>

Tôi đã sửa xong file X, thay đổi cụ thể là Y.
`;

    return basePrompt;
  }
}
