---
name: multi-agent-orchestration
description: Standardized multi-agent architecture with an orchestrator, base class, and specialized sub-agents. Use this when designing or modifying agent systems, AI workflows, or chat protocols.
---

# Kiến Trúc Multi-Agent Chuẩn Mực (Multi-Agent Orchestration)

Skill này định nghĩa bộ quy tắc kiến trúc và giao tiếp chuẩn mực cho các hệ thống Multi-Agent, đảm bảo nguyên tắc Separation of Concerns (SoC) và bảo mật luồng dữ liệu.

## 1. Nguyên Tắc Cốt Lõi (Core Principles)
- **Separation of Concerns (SoC)**: Mỗi Agent chỉ đảm nhận duy nhất MỘT vai trò cụ thể. Không "đá sân" hoặc chia sẻ chéo công cụ đặc thù.
- **Orchestrator Pattern (Mô hình Lễ Tân)**: Chỉ có duy nhất một Agent Điều phối (Orchestrator/Assistant) được phép giao tiếp trực tiếp với User và Trình duyệt. 
- **Inheritance (Kế thừa)**: Tất cả các Agent bắt buộc phải kế thừa từ một lớp ảo (BaseAgent) chứa bộ máy thực thi chung.

## 2. Phân Quyền Agent (Agent Roles)

### Base Agent (Lớp Ảo / Virtual Class)
- **Nhiệm vụ**: Cung cấp vòng lặp thực thi (ReAct loop), cơ chế parse markdown, và xử lý luồng gọi sub-agent.
- **Công cụ (Tools)**: CHỈ CHỨA các công cụ dùng chung 100% (ví dụ: `web_search`, `fetch_url`, `embedding_search`, `generate_image`).
- **Nghiêm cấm**: Tuyệt đối không chứa các tool đặc thù của domain (như đọc form, sửa code) và không hardcode logic chuyển hướng (routing) tới một agent cụ thể nào.

### Orchestrator Agent (Lễ Tân / Assistant)
- **Nhiệm vụ**: Đón nhận yêu cầu từ User, phân tích ngữ cảnh, và điều phối (giao việc) cho các Sub-Agent chuyên biệt.
- **Đặc quyền**: LÀ AGENT DUY NHẤT được phép tương tác với frontend của User (thông qua các tool như `read_fields`, `fill_form`, `request_visual_qa`).
- **Giao tiếp**: Giao việc cho Sub-Agent qua cú pháp `# AGENT_CALL`. Nhận kết quả từ Sub-Agent và tổng hợp báo cáo lại cho User qua `# REPLY_TO_USER`.

### Sub-Agents (Thợ Code / Thợ Viết / Giám đốc Mỹ thuật)
- **Nhiệm vụ**: Giải quyết các bài toán chuyên sâu (sửa file, viết bài, review UI).
- **Quy tắc**: KHÔNG BAO GIỜ tương tác trực tiếp với giao diện của User. Nếu Sub-Agent cần dữ liệu từ màn hình User (như ảnh chụp, giá trị form), chúng phải thông qua Orchestrator để lấy.
- **Giao tiếp**: Nhận lệnh từ Orchestrator. Trả kết quả (kèm flag nếu có) về cho Orchestrator thông qua `# REPLY_TO_USER`.

## 3. Chuẩn Mực Cú Pháp (Standardized Prompt Format)
Để tiết kiệm Token và tránh nhiễu ngữ cảnh, tất cả các Agent phải sử dụng chung MỘT ĐỊNH DẠNG chuẩn khi khai báo System Prompt:

```markdown
ĐỊNH DẠNG GỌI CÔNG CỤ (Dành cho việc gọi tools nội bộ):
# TOOL_CALL
## name
[tên_công_cụ]
## args
[tham_số_JSON]

DANH SÁCH CÔNG CỤ HỖ TRỢ:
- `tool_1`: Mô tả ngắn gọn. Tham số: {"key": "type"}
- `tool_2`: Mô tả ngắn gọn. Không có tham số.

ĐỊNH DẠNG BÀN GIAO CÔNG VIỆC (Dành riêng cho Orchestrator):
# AGENT_CALL
## agent
[tên_agent_con]
## args
[yêu_cầu_chi_tiết_bao_gồm_bối_cảnh]

ĐỊNH DẠNG BÁO CÁO / TRẢ LỜI:
# REPLY_TO_USER
[Nội dung trả lời hoặc báo cáo kết quả]
```

## 4. Ví Dụ Luồng Thực Thi Động (Dynamic Workflow Example)
Luồng QA tự động giữa Code và UI:
1. **DeveloperAgent** hoàn thành sửa code, trả về chuỗi `QA_URL: <url>` trong `# REPLY_TO_USER`.
2. **Orchestrator** đọc được `QA_URL`. Không trả lời User vội.
3. **Orchestrator** gọi `# TOOL_CALL request_visual_qa` kèm URL để ra lệnh trình duyệt chụp ảnh màn hình và tạm dừng backend.
4. Trình duyệt chụp ảnh xong, gửi ngược lại API. Backend thức dậy.
5. **Orchestrator** lấy được ảnh màn hình, lập tức gọi `# AGENT_CALL uiux_agent` để ném ảnh sang cho UIUXAgent đánh giá.
6. **UIUXAgent** dùng Vision AI phân tích ảnh, trả về kết quả PASS/FAIL qua `# REPLY_TO_USER`.
7. **Orchestrator** nhận kết quả và báo cáo cuối cùng cho User.
