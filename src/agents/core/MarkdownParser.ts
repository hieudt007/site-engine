export interface ParsedToolCall {
  // "INVALID": AI viet lan cung luc "# TOOL_CALL" va "# REPLY_TO_USER" trong 1 luot - trai luat
  // "1 loai hanh dong / luot" (tru rieng nhieu khoi TOOL_CALL voi nhau thi duoc). content la thong
  // bao loi de BaseAgent.run() day nguoc lai cho AI tu sua, TRANH am tham chi chay 1 loai va mat
  // lenh con lai. AGENT_CALL/USE_SKILL cu da gop thanh tool thuong (call_agent/use_skill trong
  // agentTools.ts) - khong con la "loai" rieng o day nua, giong Claude Code khong phan biet loai o
  // tang giao thuc, chi khac o cach thuc thi ben trong tung tool.
  type: "TOOL" | "REPLY" | "INVALID";
  tool: string | null;
  args: Record<string, any>;
  content: string;
  // Chi co khi type = "TOOL": AI duoc viet NHIEU khoi "# TOOL_CALL" lien tiep trong 1 luot tra loi
  // (vd can 2 tool doc lap de so sanh) - moi phan tu la 1 lan goi. "tool"/"args" o tren van la lan
  // goi DAU TIEN (tuong thich nguoc cho cho nao chi doc 2 field do), BaseAgent.run() phai loop qua
  // "calls" thay vi chi doc tool/args khi xu ly type TOOL.
  calls: { tool: string; args: Record<string, any> }[] | null;
  // Chi co khi type = "REPLY": tach cau tra loi thanh nhieu tin nhan/bubble RIENG BIET (giong
  // cach UI chat thuong gui lien tiep nhieu bubble ngan thay vi 1 doan van dai). content van la
  // ban gop (messages.join) de tuong thich nguoc voi cho nao chi doc .content.
  messages: string[] | null;
  // Chi co khi type = "REPLY": danh sach URL anh dinh kem cau tra loi (vd anh san pham).
  images: string[] | null;
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

    // Chan xung dot TRUOC KHI parse - AI viet lan ca TOOL_CALL lan REPLY_TO_USER cung luc thi
    // khong ro y dinh la tiep tuc vong lap hay ket thuc luot, day loi nguoc lai bat AI chon lai.
    const hasTool = /#\s*TOOL_CALL\n/.test(text);
    const hasReply = /#\s*REPLY_TO_USER\n/.test(text);
    if (hasTool && hasReply) {
      return {
        type: "INVALID",
        tool: null,
        args: {},
        content: "Error: you mixed TOOL_CALL and REPLY_TO_USER in one turn. Pick exactly one type (multiple TOOL_CALL blocks together is fine). Retry with one type only.",
        calls: null,
        messages: null,
        images: null,
      };
    }

    const result: ParsedToolCall = {
      type: "REPLY",
      content: text,
      tool: null,
      args: {},
      messages: null,
      images: null,
      calls: null,
    };

    // Check for # TOOL_CALL - co the co NHIEU khoi lien tiep, gom het bang matchAll thay vi chi
    // lay khoi dau tien (xem "calls" trong interface).
    const toolBlocks = [...text.matchAll(/#\s*TOOL_CALL\n(.*?)(?=\n#(?!#)|$)/gs)];
    if (toolBlocks.length > 0) {
      result.type = "TOOL";
      const calls: { tool: string; args: Record<string, any> }[] = [];

      for (const m of toolBlocks) {
        const block = m[1].trim();

        // Try JSON format
        const jsonMatch = block.match(/```json\s*(.*?)\s*```/s);
        const rawJson = jsonMatch ? jsonMatch[1] : block;
        try {
          const payload = JSON.parse(rawJson);
          if (payload && typeof payload === 'object' && payload.name) {
            calls.push({ tool: payload.name, args: payload.args || {} });
            continue;
          }
        } catch (e) {}

        // Try Headings format
        const nameMatch = block.match(/##\s*name\s*\n(.*?)\n/s);
        if (nameMatch) {
          const argsMatch = block.match(/##\s*args\s*\n(.*?)(?=\n#|$)/s);
          const args = argsMatch ? parseArgsBlock(argsMatch[1]) : {};
          calls.push({ tool: nameMatch[1].trim(), args });
        }
      }

      if (calls.length > 0) {
        result.calls = calls;
        result.tool = calls[0].tool;
        result.args = calls[0].args;
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
