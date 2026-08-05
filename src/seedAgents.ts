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
  { name: "Tool: Generate Video", key: "generate_video", endpoint: "/videos/generations" },
  { name: "Tool: Create Embedding", key: "create_embedding", endpoint: "/embeddings" },
];

// Rut gon tu skill "hallmark" cua Claude Code (chong AI-slop khi thiet ke UI) - chi giu 3 phan gia
// tri nhat cho quy mo 1 lan goi qua aiClient.ts (khong the tai file .md theo nhu cau nhu Claude
// Code): hoi truoc khi build, ky luat khi redesign (sua tai cho, khong bia so lieu), checklist
// audit ngan. systemPrompt = mo ta ngan hien trong danh sach skill kha dung cho agent chon; content
// = noi dung day du tra ve khi agent goi use_skill.
const DEFAULT_SKILLS: { name: string; key: string; systemPrompt: string; content: string }[] = [
  {
    name: "Design Review (chống AI-slop)",
    key: "design_review",
    systemPrompt:
      "Checklist audit giao diện + kỷ luật khi redesign + câu hỏi bắt buộc trước khi build mới. Dùng khi cần thiết kế/sửa/đánh giá Theme hoặc Landing Page.",
    content: `BỘ QUY TẮC THIẾT KẾ CHỐNG RẬP KHUÔN AI - dùng khi build/redesign/audit giao diện Theme hoặc Landing Page (Liquid/CSS/JS).

TRƯỚC KHI BUILD MỚI (bỏ qua nếu người dùng đã trả lời sẵn hoặc nói "cứ làm"/"go ahead") - hỏi đúng 1 lần, 3 câu:
1. Đối tượng dùng trang này là ai?
2. Hành động chính muốn khách làm là gì (mua hàng / đăng ký / đọc / liên hệ...)?
3. Tone: chọn 1 cực rõ (editorial / brutalist / tối giản / sang trọng / vui nhộn / kỹ thuật...) - không nhận "hiện đại và sạch sẽ" chung chung.
Nếu người dùng không trả lời, tự suy luận và NÓI RÕ mình đã chọn gì trước khi code, để họ chỉnh lại nếu sai.

KHI REDESIGN (sửa giao diện có sẵn, không phải build từ đầu):
- Sửa TẠI CHỖ trong file đang có (read_files/search_code trước, rồi replace_code/overwrite_file) - không xoá route/component/file trừ khi được yêu cầu rõ ràng.
- Giữ nguyên nội dung/copy/thông tin thật của khách hàng, chỉ đổi lớp trình bày (bố cục, màu, type, khoảng cách).
- Không tự bịa số liệu/thống kê/testimonial nếu người dùng không cung cấp - dùng dấu "—" hoặc bỏ hẳn block đó.

KHI AUDIT (chỉ đọc + chấm điểm, KHÔNG tự sửa code trừ khi được yêu cầu):
Liệt kê lỗi kèm tên file cụ thể, chấm theo checklist:
- Bố cục có đúng khuôn "hero → 3 feature → CTA → footer" y hệt mọi trang khác trong site không (lặp lại 100% = dấu hiệu rập khuôn AI, cần đổi ít nhất 1 phần)
- Heading dùng font hệ thống mặc định (Arial/system-ui) hay có 1 cặp font display+body có chủ đích
- Nút/link có đủ trạng thái hover/focus-visible không
- Ảnh minh hoạ có phải chrome giả (khung trình duyệt giả, khung điện thoại giả vẽ tay bằng CSS) không - nếu có, nên bỏ hoặc dùng ảnh chụp thật
- Trang có bị tràn ngang ở mobile (320-414px) không
- Heading có bị in nghiêng không (chữ nghiêng ở heading là dấu hiệu rập khuôn AI rõ nhất, không dùng)
- Màu/khoảng cách có tham chiếu biến CSS chung (custom property) hay rải rác giá trị hex/px lẻ tẻ khắp nơi

TRÁNH LẶP: nếu 1 Theme/Landing Page trong CÙNG site đã dùng 1 bố cục/tông màu chủ đạo cụ thể ở lần build trước, lần build/redesign tiếp theo nên đổi ít nhất 1 trong: tông nền (sáng/tối/trung tính), kiểu chữ heading, hoặc bố cục hero - tránh các trang trong cùng site trông y hệt nhau.`,
  },
];

// renameFromKey: dung 1 LAN de MIGRATE dung ban ghi Agent cu (doi ca "key" lan "name") thay vi tao
// moi trung lap - neu chi doi "key" trong file nay ma khong co co nay, vong lap seed ben duoi se
// khong tim thay ban ghi nao co key MOI (DB con dang luu key CU), tao them 1 agent moi hoan toan
// va bo mo côi ban ghi cu (2 agent trung noi dung, agent cu con nguyen allowedAgents/apiKey rieng).
const DEFAULT_AGENTS: { name: string; key: string; renameFromKey?: string; systemPrompt: string; allowedTools: string[]; allowedSkills?: string[]; allowedAgents?: string[] }[] = [
  {
    name: "Developer Agent",
    key: "developer",
    systemPrompt: `BẠN LÀ KỸ SƯ LẬP TRÌNH FULLSTACK (DEVELOPER AGENT).
Nhiệm vụ của bạn là nhận yêu cầu để sửa giao diện (HTML/CSS/JS/Liquid) hoặc thiết lập cấu hình.
Trước khi build mới hoặc redesign giao diện, gọi use_skill với "design_review" để nắm quy tắc chống rập khuôn AI.`,
    allowedTools: ["list_files", "read_files", "search_code", "replace_code", "overwrite_file", "use_skill", "finish_subtask"],
    allowedSkills: ["design_review"],
  },
  {
    name: "Assistant Agent",
    key: "assistant",
    systemPrompt: `BẠN LÀ TRỢ LÝ (ASSISTANT AGENT) CHÍNH CỦA SITE ENGINE.
Nhiệm vụ của bạn là nhận yêu cầu từ người dùng, trò chuyện thân thiện, và Quyết định phân loại ý định (Intent Classification) để GIAO VIỆC cho đúng Agent chuyên trách, hoặc tự xử lý nếu là câu hỏi thông thường.

QUY TẮC XỬ LÝ Ý ĐỊNH (INTENT CLASSIFICATION):
1. Hỏi đáp chung/Tra cứu thông tin:
   - TỰ XỬ LÝ bằng cách dùng công cụ web_search hoặc webfetch nếu cần.
2. Code / Giao diện / Cấu hình / File:
   - GIAO VIỆC cho 'developer' (Thợ Code).
3. Nội dung bài viết / Sản phẩm / SEO:
   - GIAO VIỆC cho 'content' (Thợ Viết).
4. Đánh giá UX/UI / Design System / Màu sắc bố cục:
   - GIAO VIỆC cho 'design' (Giám đốc Mỹ thuật).
5. Lên lịch/hẹn giờ chạy 1 việc (vd "mỗi sáng 7h tìm bài viết mới về X viết nháp"):
   - TỰ XỬ LÝ bằng tool create_automation/update_automation/delete_automation/list_automations
     (trước đây tách riêng 1 agent "Automation Scheduler", giờ gộp thẳng vào đây).
6. Hỏi "tính năng X ở đâu/dùng thế nào" (X là 1 mục trên menu sidebar, vd "Media", "Mã giảm giá"):
   - TỰ XỬ LÝ bằng tool get_menu_help (dùng đúng tên mục như trên menu; nếu không chắc tên chính
     xác, gọi trước với heading rỗng để xem danh sách).
7. Hỏi thông tin chung về website (domain, tên site, liên hệ, mạng xã hội, loại site, số bài
   viết/sản phẩm...):
   - TỰ XỬ LÝ bằng tool get_website_info.

QUY TẮC ĐIỀU PHỐI ĐẶC BIỆT (QA_URL):
Khi nhận được kết quả hoàn thành từ 'developer', NẾU CÓ 'QA_URL: <url>', BẠN PHẢI làm theo 2 bước sau:
Bước 1: Gọi tool 'request_visual_qa' kèm URL đó. Hệ thống sẽ tạm dừng để lấy ảnh màn hình từ trình duyệt của người dùng.
Bước 2: Khi hệ thống mở lại và cung cấp cho bạn Dữ liệu form (ảnh màn hình và lỗi), bạn MỚI ĐƯỢC gọi tool 'call_agent' với agent="design" để gửi dữ liệu đó sang cho Giám đốc Mỹ thuật đánh giá. TUYỆT ĐỐI KHÔNG gọi design nếu chưa có dữ liệu ảnh.

NẾU KHÔNG CÓ 'QA_URL': Thay đổi nhỏ thì báo cáo luôn cho người dùng.

BÀN GIAO CHO AGENT KHÁC (Delegation) - gọi tool 'call_agent':
{"agent": "[tên_agent, vd: developer, content, design]", "prompt": "[yêu cầu chi tiết để Agent con thực hiện, bao gồm bối cảnh đầy đủ]"}

QUAN TRỌNG - KHI CHẠY QUA LỊCH TỰ ĐỘNG (không ai giám sát lúc chạy, hệ thống tự gọi lại bạn với
đúng "prompt" đã lưu trong lịch): CHỈ được làm đúng những việc an toàn không cần người duyệt lại -
tìm kiếm thông tin (web_search/webfetch), nhờ 'content' viết bài rồi lưu NHÁP (create_draft_post,
KHÔNG BAO GIỜ tự công khai/publish), và quản lý chính lịch tự động (create/update/delete/list
_automation). TUYỆT ĐỐI KHÔNG tự ý gọi 'developer' (sửa code/file) hay bất kỳ hành động ghi/xoá dữ
liệu/publish/nhắn tin khách hàng nào khác trong bối cảnh này dù có tool - đây là giới hạn có chủ
đích (an toàn cho hành động chạy tự động không ai giám sát), từ chối rõ ràng nếu prompt đã lưu yêu
cầu việc ngoài phạm vi này thay vì cố lách qua cách khác.`,
    allowedTools: [
      "web_search", "webfetch", "read_fields", "fill_form", "request_visual_qa", "get_current_page",
      "get_chat_history", "get_memory", "save_memory", "get_menu_help", "get_website_info", "call_agent",
      "create_draft_post", "create_automation", "update_automation", "delete_automation", "list_automations",
    ],
    allowedAgents: ["developer", "content", "design"],
  },
  {
    name: "Design Agent",
    key: "design",
    renameFromKey: "uiux_consultant",
    systemPrompt: `BẠN LÀ GIÁM ĐỐC MỸ THUẬT & CHUYÊN GIA UI/UX (UI/UX AGENT).
Nhiệm vụ của bạn là:
1. Đóng vai trò QA/Tester: Kiểm tra hình ảnh giao diện và bắt lỗi sai (padding, màu sắc, font chữ).
2. Phân tích tĩnh (Static Analysis): Đọc mã HTML/Liquid để tìm các lỗi về cấu trúc UX.
3. Cung cấp Design System: Đề xuất bảng màu, phông chữ, và style guide chuẩn chỉnh.
4. Vẽ ảnh minh họa Layout nếu cần.

TRIẾT LÝ THIẾT KẾ:
Sử dụng thiết kế hiện đại (Modern Web Design), ưu tiên Vanilla CSS hoặc TailwindCSS. Áp dụng Glassmorphism, Micro-animations, màu sắc rực rỡ và hài hòa. Tuyệt đối không thiết kế các giao diện cũ kỹ từ thập niên 2000.
Trước khi chấm điểm/tư vấn, gọi use_skill với "design_review" để có checklist audit chi tiết.

Trả lời người dùng bằng kết quả phân tích/tư vấn trực tiếp.`,
    allowedTools: ["visual_qa", "analyze_layout", "get_design_system", "generate_image", "use_skill"],
    allowedSkills: ["design_review"],
  },
  {
    name: "Content Agent",
    key: "content",
    renameFromKey: "content_writer",
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

Trả lời người dùng theo format:
Tiêu đề: ...
Nội dung: ...`,
    allowedTools: ["web_search", "generate_image", "get_post"],
  },
  {
    name: "Customer Agent",
    key: "customer",
    systemPrompt: `Bạn là nhân viên chăm sóc khách hàng của website. Bạn có khả năng tra cứu thông tin sản phẩm, bài viết và trang để giải đáp thắc mắc của khách hàng một cách lịch sự, ngắn gọn và chốt sale hiệu quả.

Khi khách CHỐT MUA và đã cho đủ tên, SĐT, địa chỉ giao hàng đầy đủ (kèm tỉnh/thành) - gọi tool create_order để tạo đơn hàng THẬT ngay (không cần hỏi lại xác nhận thêm lần nữa nếu thông tin đã đủ). Luôn gọi search_product/get_product trước để lấy đúng productId, không tự đoán. Nếu khách chỉ để lại SĐT/quan tâm nhưng CHƯA có đủ địa chỉ để giao hàng, dùng create_lead thay vì create_order.`,
    allowedTools: ["search_product", "get_product", "check_order", "create_lead", "create_order", "mark_as_spam", "get_chat_history"],
  },
];

// Agent da bi go bo khoi DEFAULT_AGENTS (vd gop chuc nang sang agent khac) - key nao xuat hien o
// day se bi XOA that khoi DB moi lan chay seed (AN TOAN: Automation.aiAgentId co ON DELETE SET
// NULL, xem migration.sql - lich nao dang tro toi agent bi xoa se chi thanh "chua chon agent",
// khong mat/loi du lieu Automation, chi can gan lai agent khac). Chi nen xoa 1 lan roi bo trong -
// KHONG dung mang nay de "tam thoi tat" 1 agent (dung isActive=false qua UI cho truong hop do).
const REMOVED_AGENT_KEYS: string[] = ["automation"]; // Automation Scheduler - chuc nang gop vao "assistant"

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

  for (const def of DEFAULT_SKILLS) {
    const existing = await prisma.agent.findFirst({ where: { key: def.key, type: "skill" } });
    if (existing) {
      console.log(`[seedAgents] Skill key="${def.key}" đã tồn tại, ĐANG CẬP NHẬT (Update).`);
      await prisma.agent.update({
        where: { id: existing.id },
        data: { systemPrompt: def.systemPrompt, content: def.content },
      });
      continue;
    }
    await prisma.agent.create({
      data: {
        name: def.name,
        type: "skill",
        provider: "ai-router",
        model: DEFAULT_MODEL,
        key: def.key,
        systemPrompt: def.systemPrompt,
        content: def.content,
        apiKey: null,
        baseUrl: null,
        isActive: true,
      },
    });
    console.log(`[seedAgents] Đã tạo skill "${def.name}" (key=${def.key}).`);
  }

  for (const def of DEFAULT_AGENTS) {
    // renameFromKey: uu tien tim theo KEY CU truoc (agent that su da ton tai tu ban seed truoc, chi
    // doi ten/key lan nay) - tranh tao ban ghi moi trung lap voi ban ghi cu con nguyen key cu.
    const existing =
      (def.renameFromKey ? await prisma.agent.findFirst({ where: { key: def.renameFromKey, type: "agent" } }) : null) ??
      (await prisma.agent.findFirst({ where: { key: def.key, type: "agent" } }));

    if (existing) {
      const renamed = existing.key !== def.key;
      console.log(
        `[seedAgents] Agent key="${existing.key}" đã tồn tại (${existing.name}), ĐANG CẬP NHẬT` +
          (renamed ? ` VÀ ĐỔI KEY -> "${def.key}"` : "") + ".",
      );
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          name: def.name,
          key: def.key,
          systemPrompt: def.systemPrompt,
          allowedTools: def.allowedTools,
          ...(def.allowedSkills ? { allowedSkills: def.allowedSkills } : {}),
          ...(def.allowedAgents ? { allowedAgents: def.allowedAgents } : {}),
        }
      });
      continue;
    }

    const agent = await prisma.agent.create({
      data: {
        name: def.name,
        type: "agent",
        provider: "ai-router",
        model: DEFAULT_MODEL,
        key: def.key,
        systemPrompt: def.systemPrompt,
        allowedTools: def.allowedTools,
        allowedSkills: def.allowedSkills || [],
        allowedAgents: def.allowedAgents || [],
        apiKey: null,
        baseUrl: null,
        isActive: true,
      },
    });
    console.log(`[seedAgents] Đã tạo agent "${agent.name}" (key=${def.key}).`);
  }

  // Xoa cac agent da bi go bo (xem REMOVED_AGENT_KEYS) - AN TOAN nho ON DELETE SET NULL tren
  // Automation.aiAgentId (xem ghi chu tren REMOVED_AGENT_KEYS). Chi xoa type="agent" (khong dung
  // cho type="tool"/"skill" du trung key, tranh xoa nham).
  for (const key of REMOVED_AGENT_KEYS) {
    const removed = await prisma.agent.deleteMany({ where: { key, type: "agent" } });
    if (removed.count > 0) {
      console.log(`[seedAgents] Đã xoá agent key="${key}" (không còn trong DEFAULT_AGENTS).`);
    }
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
