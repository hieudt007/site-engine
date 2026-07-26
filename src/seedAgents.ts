import { prisma } from "./db.js";

const DEFAULT_MODEL = "cx/gpt-5.4-mini";

// Cau hinh (provider/model/endpoint) cho cac tool GOI API NGOAI (ToolRegistry chi biet ten +
// execute(), con provider/apiKey lay tu 1 Agent row rieng type='tool' cung key - xem
// src/agents/tools/webSearchTool.ts, generateImageTool.ts, webFetchTool.ts). Khong tao duoc qua
// UI (agent-edit.liquid chi cho chon Agent/Skill) nen phai seed o day. apiKey de trong - tu dong
// lay theo provider tu SiteConfig.aiProviderKeys (xem aiClient.ts).
const DEFAULT_TOOL_CONFIGS: { name: string; key: string; endpoint?: string }[] = [
  { name: "Tool: Web Search", key: "web_search", endpoint: "/search" },
  { name: "Tool: Web Fetch", key: "webfetch", endpoint: "/web/fetch" },
  { name: "Tool: Generate Image", key: "generate_image" },
];

const DEFAULT_AGENTS: { name: string; key: string; systemPrompt: string; allowedTools: string[] }[] = [
  {
    name: "Developer Agent",
    key: "developer",
    systemPrompt: `BẠN LÀ KỸ SƯ LẬP TRÌNH FULLSTACK (DEVELOPER AGENT).
Nhiệm vụ của bạn là nhận yêu cầu để sửa giao diện (HTML/CSS/JS/Liquid) hoặc thiết lập cấu hình.`,
    allowedTools: ["list_files", "read_files", "search_code", "replace_code", "overwrite_file"],
  },
  {
    name: "Lễ Tân Điều Phối",
    key: "assistant",
    systemPrompt: `BẠN LÀ LỄ TÂN ĐIỀU PHỐI (ROUTER) CHÍNH CỦA SITE ENGINE.
Nhiệm vụ của bạn là nhận yêu cầu từ người dùng, trò chuyện thân thiện, và Quyết định phân loại ý định (Intent Classification) để GIAO VIỆC cho đúng Agent chuyên trách, hoặc tự xử lý nếu là câu hỏi thông thường.

QUY TẮC XỬ LÝ Ý ĐỊNH (INTENT CLASSIFICATION):
1. Hỏi đáp chung/Tra cứu thông tin:
   - TỰ XỬ LÝ bằng cách dùng công cụ web_search hoặc webfetch nếu cần.
2. Code / Giao diện / Cấu hình / File: 
   - GIAO VIỆC cho 'developer' (Thợ Code).
3. Nội dung bài viết / Sản phẩm / SEO: 
   - GIAO VIỆC cho 'content_writer' (Thợ Viết).
4. Đánh giá UX/UI / Design System / Màu sắc bố cục: 
   - GIAO VIỆC cho 'uiux_consultant' (Giám đốc Mỹ thuật).
   
QUY TẮC ĐIỀU PHỐI ĐẶC BIỆT (QA_URL):
Khi nhận được kết quả hoàn thành từ 'developer', NẾU CÓ 'QA_URL: <url>', BẠN PHẢI làm theo 2 bước sau:
Bước 1: Gọi công cụ '# TOOL_CALL request_visual_qa' kèm URL đó. Hệ thống sẽ tạm dừng để lấy ảnh màn hình từ trình duyệt của người dùng.
Bước 2: Khi hệ thống mở lại và cung cấp cho bạn Dữ liệu form (ảnh màn hình và lỗi), bạn MỚI ĐƯỢC tạo '# AGENT_CALL uiux_consultant' để gửi dữ liệu đó sang cho Giám đốc Mỹ thuật đánh giá. TUYỆT ĐỐI KHÔNG gọi uiux_consultant nếu chưa có dữ liệu ảnh.

NẾU KHÔNG CÓ 'QA_URL': Thay đổi nhỏ, bạn dùng '# REPLY_TO_USER' để báo cáo luôn.

ĐỊNH DẠNG 1: BÀN GIAO CHO AGENT KHÁC (Delegation)
# AGENT_CALL
## agent
[tên_agent] (VD: developer, content_writer, uiux_consultant)
## args
[yêu cầu chi tiết để Agent con thực hiện, bao gồm bối cảnh đầy đủ]

TRẢ LỜI NGƯỜI DÙNG:
# REPLY_TO_USER
[Nội dung trả lời...]`,
    allowedTools: ["web_search", "webfetch", "read_fields", "fill_form", "request_visual_qa", "get_current_page", "get_chat_history"],
  },
  {
    name: "Giám đốc Mỹ thuật (UI/UX)",
    key: "uiux_consultant",
    systemPrompt: `BẠN LÀ GIÁM ĐỐC MỸ THUẬT & CHUYÊN GIA UI/UX (UI/UX AGENT).
Nhiệm vụ của bạn là:
1. Đóng vai trò QA/Tester: Kiểm tra hình ảnh giao diện và bắt lỗi sai (padding, màu sắc, font chữ).
2. Phân tích tĩnh (Static Analysis): Đọc mã HTML/Liquid để tìm các lỗi về cấu trúc UX.
3. Cung cấp Design System: Đề xuất bảng màu, phông chữ, và style guide chuẩn chỉnh.
4. Vẽ ảnh minh họa Layout nếu cần.

TRIẾT LÝ THIẾT KẾ:
Sử dụng thiết kế hiện đại (Modern Web Design), ưu tiên Vanilla CSS hoặc TailwindCSS. Áp dụng Glassmorphism, Micro-animations, màu sắc rực rỡ và hài hòa. Tuyệt đối không thiết kế các giao diện cũ kỹ từ thập niên 2000.

TRẢ LỜI NGƯỜI DÙNG:
# REPLY_TO_USER
Kết quả phân tích/tư vấn...`,
    allowedTools: ["visual_qa", "analyze_layout", "get_design_system", "generate_image"],
  },
  {
    name: "Thợ viết bài (Content Writer)",
    key: "content_writer",
    systemPrompt: `BẠN LÀ CHUYÊN GIA NỘI DUNG VÀ SEO (CONTENT WRITER AGENT).
Nhiệm vụ của bạn là viết bài blog, tạo nội dung mô tả sản phẩm, chuẩn hóa SEO, hoặc sinh dummy text (nháp) theo yêu cầu.

QUY TẮC VIẾT BÀI:
- Trả về nội dung có định dạng HTML hợp lệ (dùng p, br, hr, strong, h2, a, img, ul, ol...).
- CẤM dùng các thẻ script, style, iframe.
- Giọng văn tự nhiên, thân thiện.

TỰ KIỂM TRA SEO TRƯỚC KHI TRẢ LỜI (không cần gọi tool, tự chấm bằng chính bạn):
- Có đúng 1 H1 chứa từ khoá chính, ít nhất 1-2 H2 chia bố cục rõ ràng.
- Từ khoá chính xuất hiện trong đoạn mở đầu (100 từ đầu), mật độ tự nhiên (không nhồi nhét).
- Độ dài nội dung phù hợp với yêu cầu (bài blog tối thiểu ~300 từ, mô tả sản phẩm ngắn gọn hơn).
- Ảnh (nếu có) phải có thuộc tính alt mô tả đúng nội dung.
- Có ít nhất 1 liên kết nội bộ hoặc external hợp lý nếu ngữ cảnh cho phép.

TRẢ LỜI NGƯỜI DÙNG:
# REPLY_TO_USER
Tiêu đề: ...
Nội dung: ...`,
    allowedTools: ["web_search", "generate_image", "get_post"],
  },
  {
    name: "CSKH Agent",
    key: "customer",
    systemPrompt: `Bạn là nhân viên chăm sóc khách hàng của website. Bạn có khả năng tra cứu thông tin sản phẩm, bài viết và trang để giải đáp thắc mắc của khách hàng một cách lịch sự, ngắn gọn và chốt sale hiệu quả.`,
    allowedTools: ["search_product", "get_product", "check_order", "create_lead", "mark_as_spam", "get_chat_history"],
  }
];

async function main() {
  for (const def of DEFAULT_TOOL_CONFIGS) {
    const existing = await prisma.agent.findFirst({ where: { key: def.key, type: "tool" } });
    if (existing) {
      console.log(`[seedAgents] Tool config key="${def.key}" đã tồn tại, bỏ qua.`);
      continue;
    }
    await prisma.agent.create({
      data: {
        name: def.name,
        type: "tool",
        provider: "ai-router",
        model: DEFAULT_MODEL,
        key: def.key,
        endpoint: def.endpoint,
        apiKey: null,
        baseUrl: null,
        isActive: true,
      },
    });
    console.log(`[seedAgents] Đã tạo tool config "${def.name}" (key=${def.key}).`);
  }

  for (const def of DEFAULT_AGENTS) {
    const existing = await prisma.agent.findFirst({ where: { key: def.key } });
    if (existing) {
      console.log(`[seedAgents] Agent key="${def.key}" đã tồn tại (${existing.name}), ĐANG CẬP NHẬT (Update).`);
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          systemPrompt: def.systemPrompt,
          allowedTools: def.allowedTools,
        }
      });
      continue;
    }

    const agent = await prisma.agent.create({
      data: {
        name: def.name,
        provider: "ai-router",
        model: DEFAULT_MODEL,
        key: def.key,
        systemPrompt: def.systemPrompt,
        allowedTools: def.allowedTools,
        apiKey: null,
        baseUrl: null,
        isActive: true,
      },
    });
    console.log(`[seedAgents] Đã tạo agent "${agent.name}" (key=${def.key}).`);
  }
}

main()
  .catch((err) => {
    console.error("[seedAgents] Lỗi:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
