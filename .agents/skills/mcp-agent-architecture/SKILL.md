---
name: mcp-agent-architecture
description: Hướng dẫn toàn tập về kiến trúc luồng AI, cơ chế gọi MCP Tool, Agent Loop và cấu trúc Database tại Site-Engine.
---

# 🧠 Kiến trúc AI & MCP Tool tại Site-Engine

Bí kíp này mô tả chi tiết cách hệ thống Site-Engine quản lý các AI Agent, cách Agent gọi công cụ (Tool Calling) qua chuẩn MCP và cấu trúc dữ liệu đằng sau. Sử dụng bí kíp này khi bạn cần debug luồng AI, tạo thêm công cụ mới, hoặc hiểu về cơ chế phân phối nhiệm vụ giữa các Agent.

## 1. Cấu trúc Database (Prisma Schema)

Hệ thống lưu trữ cấu hình Agent tại bảng `Agent` trong `schema.prisma`. Bảng này quyết định AI sẽ sử dụng model nào, system prompt ra sao, và được phép dùng những công cụ nào.

```prisma
model Agent {
  id           String   @id @default(cuid())
  key          String?  @unique // vd: "developer", "content_writer"
  name         String
  type         String   @default("agent") // 'agent' | 'tool' | 'skill'
  provider     String   @default("openai")
  model        String
  systemPrompt String?
  allowedTools String[] @default([]) // Danh sách key của các công cụ (vd: "read_files")
  apiKey       String?
  baseUrl      String?
  endpoint     String   @default("/chat/completions")
  isSystem     Boolean  @default(false)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- **`allowedTools`**: Đóng vai trò màng lọc. Chỉ những công cụ có tên trong mảng này mới được đưa vào `systemPrompt` của Agent.
- Lịch sử chat được lưu tại bảng `AdminChatHistory` (đối với admin) hoặc `CustomerChatMessage` (đối với live-chat khách hàng).

## 2. Tool Registry (Quản lý Công cụ MCP)

Các công cụ không lưu logic trong Database mà được lập trình cứng trong code bằng TypeScript, thông qua lớp `ToolRegistry` (`src/agents/core/ToolRegistry.ts`).

### Interface của một Tool chuẩn MCP:
```typescript
export interface MCPTool {
  name: string;
  description: string; // Bao gồm cả hướng dẫn schema tham số
  execute: (args: Record<string, any>, context: AgentContext) => Promise<string>;
}
```

### Đăng ký Tool:
Các tool được định nghĩa trong thư mục `src/agents/tools/` (vd: `fileTools.ts`, `contentTools.ts`). Khi app khởi động, `src/server.ts` sẽ import `index.ts` để đăng ký toàn bộ Tool vào hệ thống thông qua `ToolRegistry.register()`.

## 3. Vòng lặp Suy nghĩ của Agent (Agent Loop)

Trái tim của hệ thống AI nằm ở `BaseAgent.ts`. Mỗi khi user gửi tin nhắn, `BaseAgent.run()` sẽ khởi chạy vòng lặp để AI tự quyết định sẽ trả lời luôn hay gọi Tool.
**Giới hạn vòng lặp (`maxSteps` hay `maxLoops`)**: Số lần lặp tối đa được cấu hình độc lập cho *riêng* từng Agent (qua trường `maxLoops` trong DB). Nếu Agent A gọi uỷ quyền cho Agent B, vòng lặp của B được tính hoàn toàn độc lập, không cộng dồn vào A.

### Luồng thực thi:
1. Gộp lịch sử tin nhắn thật (không gộp thành 1 chuỗi dài như cách cũ) truyền vào AI. Lưu ý: Lịch sử chat cũ không còn bị nhồi tự động vào mọi luồng, thay vào đó có tool cơ bản `get_chat_history` để AI tự gọi khi cần tra cứu ngữ cảnh cũ, tiết kiệm token.
2. Lấy `rawResponse` từ LLM.
3. Chạy qua `MarkdownParser.ts` để bóc tách xem AI muốn làm gì (dựa vào Headings).
4. Thực thi:
   - Nếu là **TOOL**: Gọi hàm `executeTool()`, chờ lấy kết quả, nạp kết quả đó vào danh sách tin nhắn giả làm `user` phản hồi, lặp lại bước 1.
   - Nếu là **AGENT**: Chuyển giao ngữ cảnh cho 1 Agent khác qua `handleAgentCall()`. (Lưu ý: Agent con khởi động lặn, không kế thừa history của agent cha, agent cha phải tóm tắt truyền vào prompt).
   - Nếu là **SKILL**: Truy xuất nội dung bí kíp từ bảng Agent (loại `skill`), nạp vào làm ngữ cảnh và lặp lại bước 1.
   - Nếu là **REPLY_TO_USER**: Kết thúc vòng lặp, hiển thị câu trả lời ra UI.

### Giao tiếp Thời gian thực (Streaming):
Trong quá trình lặp, Agent dùng `streamMessage()` và `streamNextTask()` đẩy trạng thái qua SSE (Server-Sent Events) để Frontend hiển thị tiến trình (VD: `"Đang đọc file..."`, `"Đang tạo ảnh..."`).

## 4. Định dạng Bắt buộc (LLM Output Format)

Bất kỳ AI Agent nào trong hệ thống cũng bị ép tuân theo 1 trong 3 định dạng trả về, bóc tách bằng Markdown Headings (Quy định tại hằng số `RESPONSE_FORMAT_GUIDE` trong `BaseAgent.ts`).

### A. Gọi Công cụ (Tool Call)
Dùng khi AI muốn xài 1 công cụ có trong `allowedTools`.
```markdown
# TOOL_CALL
## name
read_files
## args
{"paths": ["src/server.ts"]}
## next_task
Đọc nội dung file server để kiểm tra cấu hình
```

### B. Chuyển giao Agent (Agent Call)
Dùng khi một Agent muốn uỷ quyền cho Agent khác (VD: Product Agent nhờ UIUX Agent làm ảnh).
```markdown
# AGENT_CALL
## agent
uiux_consultant
## payload
### prompt
Viết nội dung quảng cáo cho ảnh này
```

### C. Trả lời Người dùng cuối
Dùng khi đã có đủ thông tin, cần kết thúc luồng. Có thể kèm mảng ảnh hoặc tách riêng các bubble chat.
```markdown
# REPLY_TO_USER
```json
{
  "messages": ["Dạ em tìm thấy sản phẩm rồi ạ.", "Chiếc iPhone này đang có giá ưu đãi!"],
  "images": ["/uploads/iphone.png"]
}
```
```

### D. Dùng Kỹ năng (Use Skill)
Dùng khi AI muốn sử dụng một "Bí kíp" (Skill) đã được cấp phép trong `allowedSkills`. AI lấy hướng dẫn chi tiết để tự làm, KHÔNG bàn giao việc cho ai khác, AI vẫn là người thực hiện tiếp sau khi đọc xong.
```markdown
# USE_SKILL
## skill
<skill_key>
```

### Chế độ chia Task (Task Splitting)
Đối với bất kỳ action nào (TOOL_CALL, AGENT_CALL, USE_SKILL), AI có thể thêm một khối `## next_task` để thông báo cho người dùng biết dự định tiếp theo (ví dụ khi chia nhỏ một công việc phức tạp thành nhiều bước).
```markdown
## next_task
Đọc nội dung file server để kiểm tra cấu hình
```

## 5. Dữ liệu Truyền vào (AgentContext)

Mỗi Tool khi được kích hoạt sẽ nhận 2 tham số: `args` (từ JSON của LLM) và `context`.
```typescript
export interface AgentContext {
  meta: Record<string, any>; // Lưu trữ toolData, availableFields, layoutMode...
  history: ChatHistoryItem[]; // Lịch sử đoạn chat
  reply?: FastifyReply; // Đối tượng res để gọi stream ra Frontend
  agentModel?: Agent; // Tham chiếu về chính Agent đang chạy
}
```

Nhờ cấu trúc này, hệ thống hoạt động vô cùng linh hoạt, LLM được tách rời khỏi code, mọi công cụ mới chỉ cần code 1 file nhỏ rồi ném vào `ToolRegistry` là có thể chạy ngay lập tức.
