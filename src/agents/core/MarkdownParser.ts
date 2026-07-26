export interface ParsedToolCall {
  type: "TOOL" | "AGENT" | "SKILL" | "REPLY";
  tool: string | null;
  args: Record<string, any>;
  content: string;
  // Tuy chon - viec AI du dinh lam o buoc SAU (chi co khi AI dang tu chia nho 1 task nhieu buoc).
  // Stream ngay TRUOC luot goi AI tiep theo (xem BaseAgent.run()), khong dung timer co dinh.
  nextTask: string | null;
  // Chi co khi type = "REPLY": tach cau tra loi thanh nhieu tin nhan/bubble RIENG BIET (giong
  // cach UI chat thuong gui lien tiep nhieu bubble ngan thay vi 1 doan van dai). content van la
  // ban gop (messages.join) de tuong thich nguoc voi cho nao chi doc .content.
  messages: string[] | null;
  // Chi co khi type = "REPLY": danh sach URL anh dinh kem cau tra loi (vd anh san pham).
  images: string[] | null;
}

// Lay 1 dong gia tri sau 1 heading "## key" trong block (dung cho next_task).
function extractHeadingLine(block: string, heading: string): string | null {
  const match = block.match(new RegExp(`##\\s*${heading}\\s*\\n(.*?)(?=\\n##|\\n#|$)`, "s"));
  return match ? match[1].trim() || null : null;
}

// Parse noi dung ben trong "## args"/"## payload" - dang chuan la nhieu "### key\nvalue", nhung
// model hay bo qua cac ### con, viet thang 1 cuc JSON tho ngay duoi heading (vd '{"fields": [...]}')
// - neu khong tim thay ### nao, thu JSON.parse ca block truoc khi bo cuoc (tra {} rong).
function parseArgsBlock(argsBlock: string): Record<string, any> {
  const args: Record<string, any> = {};
  const argRegex = /###\s*([^\n]+)\s*\n(.*?)(?=\n###|$)/gs;
  let match;
  let found = false;
  while ((match = argRegex.exec(argsBlock)) !== null) {
    found = true;
    const key = match[1].trim();
    let val = match[2].trim();
    val = val.replace(/^```(?:html|css|js|json|php|txt|markdown)?\s*\n(.*?)\n```$/s, '$1');
    args[key] = val;
  }
  if (found) return args;

  const jsonMatch = argsBlock.match(/```json\s*(.*?)\s*```/s);
  const rawJson = jsonMatch ? jsonMatch[1] : argsBlock.trim();
  try {
    const payload = JSON.parse(rawJson);
    if (payload && typeof payload === 'object') return payload;
  } catch (e) {}
  return args;
}

export class MarkdownParser {
  /**
   * Parse Markdown Headings (or fallback to JSON) from the LLM's response.
   */
  static parse(rawText: string): ParsedToolCall {
    // Chuan hoa line ending 1 LAN duy nhat o day - vai provider/model tra ve "\r\n" (Windows-style)
    // thay vi "\n" thuan, khien MOI regex ben duoi (deu dung literal "\n") khong khop duoc, parser
    // roi vao fallback mac dinh (coi ca khoi "# REPLY_TO_USER\n{...}" la text tho, hien nguyen van
    // cho user thay ca heading chua bi boc tach).
    const text = rawText.replace(/\r\n/g, "\n");
    const result: ParsedToolCall = {
      type: "REPLY",
      content: text,
      tool: null,
      args: {},
      nextTask: null,
      messages: null,
      images: null,
    };

    // Check for # TOOL_CALL
    const toolMatch = text.match(/#\s*TOOL_CALL\n(.*?)(?=\n#(?!#)|$)/s);
    if (toolMatch) {
      result.type = "TOOL";
      const block = toolMatch[1].trim();

      // Try JSON format
      const jsonMatch = block.match(/```json\s*(.*?)\s*```/s);
      const rawJson = jsonMatch ? jsonMatch[1] : block;
      try {
        const payload = JSON.parse(rawJson);
        if (payload && typeof payload === 'object' && payload.name) {
          result.tool = payload.name;
          result.args = payload.args || {};
          result.nextTask = payload.next_task || payload.nextTask || null;
          return result;
        }
      } catch (e) {}

      // Try Headings format
      const nameMatch = block.match(/##\s*name\s*\n(.*?)\n/s);
      if (nameMatch) {
        result.tool = nameMatch[1].trim();
        result.args = {};

        const argsMatch = block.match(/##\s*args\s*\n(.*?)(?=\n##\s*next_task\s*\n|$)/s);
        if (argsMatch) {
          result.args = parseArgsBlock(argsMatch[1]);
        }
        result.nextTask = extractHeadingLine(block, "next_task");
        return result;
      }
    }

    // Check for # AGENT_CALL
    const agentMatch = text.match(/#\s*AGENT_CALL\n(.*?)(?=\n#(?!#)|$)/s);
    if (agentMatch) {
      result.type = "AGENT";
      const block = agentMatch[1].trim();

      // Try JSON format
      const jsonMatch = block.match(/```json\s*(.*?)\s*```/s);
      const rawJson = jsonMatch ? jsonMatch[1] : block;
      try {
        const payload = JSON.parse(rawJson);
        if (payload && typeof payload === 'object' && payload.agent) {
          result.tool = payload.agent;
          result.args = payload.payload || {};
          result.nextTask = payload.next_task || payload.nextTask || null;
          return result;
        }
      } catch (e) {}

      // Try Headings format
      const nameMatch = block.match(/##\s*agent\s*\n(.*?)\n/s);
      if (nameMatch) {
        result.tool = nameMatch[1].trim();
        result.args = {};

        const argsMatch = block.match(/##\s*payload\s*\n(.*?)(?=\n##\s*next_task\s*\n|$)/s);
        if (argsMatch) {
          result.args = parseArgsBlock(argsMatch[1]);
        }
        result.nextTask = extractHeadingLine(block, "next_task");
        return result;
      }
    }

    // Check for # USE_SKILL
    const skillMatch = text.match(/#\s*USE_SKILL\n(.*?)(?=\n#(?!#)|$)/s);
    if (skillMatch) {
      result.type = "SKILL";
      const block = skillMatch[1].trim();

      const jsonMatch = block.match(/```json\s*(.*?)\s*```/s);
      const rawJson = jsonMatch ? jsonMatch[1] : block;
      try {
        const payload = JSON.parse(rawJson);
        if (payload && typeof payload === 'object' && payload.skill) {
          result.tool = payload.skill;
          result.nextTask = payload.next_task || payload.nextTask || null;
          return result;
        }
      } catch (e) {}

      const nameMatch = block.match(/##\s*skill\s*\n(.*?)\n/s) || block.match(/##\s*skill\s*\n(.*)$/s);
      if (nameMatch) {
        result.tool = nameMatch[1].trim();
        result.nextTask = extractHeadingLine(block, "next_task");
        return result;
      }
    }

    // Check for # REPLY_TO_USER
    const replyMatch = text.match(/#\s*REPLY_TO_USER\n(.*)/s);
    if (replyMatch) {
      result.type = "REPLY";
      const raw = replyMatch[1].trim();

      // Thu JSON truoc: {"messages": ["tin 1", "tin 2"], "images": ["url", ...]} - moi phan tu
      // trong messages la 1 bubble chat RIENG BIET, khong phai gop chung 1 doan van.
      const jsonMatch = raw.match(/```json\s*(.*?)\s*```/s);
      const rawJson = jsonMatch ? jsonMatch[1] : raw;
      try {
        const payload = JSON.parse(rawJson);
        if (payload && typeof payload === 'object' && Array.isArray(payload.messages)) {
          const messages: string[] = payload.messages.filter((m: unknown) => typeof m === 'string' && m.trim());
          result.messages = messages;
          result.images = Array.isArray(payload.images) ? payload.images.filter((i: unknown) => typeof i === 'string' && i.trim()) : [];
          result.content = messages.join('\n\n');
          return result;
        }
      } catch (e) {}

      // Fallback: van ban thuong - coi nhu 1 tin nhan duy nhat, khong anh.
      result.content = raw;
      result.messages = raw ? [raw] : [];
      result.images = [];
    }

    return result;
  }
}
