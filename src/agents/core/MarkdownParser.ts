export interface ParsedToolCall {
  type: "TOOL" | "AGENT" | "REPLY" | "FILL_FORM";
  tool: string | null;
  args: Record<string, any>;
  content: string;
  // Thong bao ngan AI tu giai thich dang lam gi - stream len frontend NGAY (giong luong aiChat.ts
  // cu). Bat buoc de nguoi dung thay progress thay vi label cung.
  message: string | null;
  // Tuy chon - viec AI du dinh lam o buoc SAU (chi co khi AI dang tu chia nho 1 task nhieu buoc).
  // Stream ngay TRUOC luot goi AI tiep theo (xem BaseAgent.run()), khong dung timer co dinh.
  nextTask: string | null;
  // Chi co khi type = "FILL_FORM": map field_id -> gia tri can ghi vao post/page/product/theme.
  fields: Record<string, string> | null;
}

// Lay 1 dong gia tri sau 1 heading "## key" trong block (dung cho message/next_task - deu la
// gia tri 1 dong, khac voi args/payload la block nhieu dong nen dung regex rieng).
function extractHeadingLine(block: string, heading: string): string | null {
  const match = block.match(new RegExp(`##\\s*${heading}\\s*\\n(.*?)(?=\\n##|\\n#|$)`, "s"));
  return match ? match[1].trim() || null : null;
}

export class MarkdownParser {
  /**
   * Parse Markdown Headings (or fallback to JSON) from the LLM's response.
   */
  static parse(text: string): ParsedToolCall {
    const result: ParsedToolCall = {
      type: "REPLY",
      content: text,
      tool: null,
      args: {},
      message: null,
      nextTask: null,
      fields: null,
    };

    // Check for # TOOL_CALL
    const toolMatch = text.match(/#\s*TOOL_CALL\n(.*?)(?=\n#|$)/s);
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
          result.message = payload.message || null;
          result.nextTask = payload.next_task || payload.nextTask || null;
          return result;
        }
      } catch (e) {}

      // Try Headings format
      const nameMatch = block.match(/##\s*name\s*\n(.*?)\n/s);
      if (nameMatch) {
        result.tool = nameMatch[1].trim();
        result.args = {};

        const argsMatch = block.match(/##\s*args\s*\n(.*?)(?=\n##\s*(?:message|next_task)\s*\n|$)/s);
        if (argsMatch) {
          const argsBlock = argsMatch[1];
          const argRegex = /###\s*([^\n]+)\s*\n(.*?)(?=\n###|$)/gs;
          let match;
          while ((match = argRegex.exec(argsBlock)) !== null) {
            const key = match[1].trim();
            let val = match[2].trim();
            // Remove wrapping code blocks
            val = val.replace(/^```(?:html|css|js|json|php|txt|markdown)?\s*\n(.*?)\n```$/s, '$1');
            result.args[key] = val;
          }
        }
        result.message = extractHeadingLine(block, "message");
        result.nextTask = extractHeadingLine(block, "next_task");
        return result;
      }
    }

    // Check for # AGENT_CALL
    const agentMatch = text.match(/#\s*AGENT_CALL\n(.*?)(?=\n#|$)/s);
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
          result.message = payload.message || null;
          result.nextTask = payload.next_task || payload.nextTask || null;
          return result;
        }
      } catch (e) {}

      // Try Headings format
      const nameMatch = block.match(/##\s*agent\s*\n(.*?)\n/s);
      if (nameMatch) {
        result.tool = nameMatch[1].trim();
        result.args = {};

        const argsMatch = block.match(/##\s*payload\s*\n(.*?)(?=\n##\s*(?:message|next_task)\s*\n|$)/s);
        if (argsMatch) {
          const argsBlock = argsMatch[1];
          const argRegex = /###\s*([^\n]+)\s*\n(.*?)(?=\n###|$)/gs;
          let match;
          while ((match = argRegex.exec(argsBlock)) !== null) {
            const key = match[1].trim();
            let val = match[2].trim();
            val = val.replace(/^```(?:html|css|js|json|php|txt|markdown)?\s*\n(.*?)\n```$/s, '$1');
            result.args[key] = val;
          }
        }
        result.message = extractHeadingLine(block, "message");
        result.nextTask = extractHeadingLine(block, "next_task");
        return result;
      }
    }

    // Check for # FILL_FORM
    const fillFormMatch = text.match(/#\s*FILL_FORM\n(.*?)(?=\n#|$)/s);
    if (fillFormMatch) {
      result.type = "FILL_FORM";
      const block = fillFormMatch[1].trim();

      // Try JSON format
      const jsonMatch = block.match(/```json\s*(.*?)\s*```/s);
      const rawJson = jsonMatch ? jsonMatch[1] : block;
      try {
        const payload = JSON.parse(rawJson);
        if (payload && typeof payload === 'object' && payload.fields) {
          result.fields = payload.fields;
          result.message = payload.message || null;
          return result;
        }
      } catch (e) {}

      // Try Headings format
      result.fields = {};
      const fieldsMatch = block.match(/##\s*fields\s*\n(.*?)(?=\n##\s*message\s*\n|$)/s);
      if (fieldsMatch) {
        const fieldsBlock = fieldsMatch[1];
        const fieldRegex = /###\s*([^\n]+)\s*\n(.*?)(?=\n###|$)/gs;
        let match;
        while ((match = fieldRegex.exec(fieldsBlock)) !== null) {
          const key = match[1].trim();
          let val = match[2].trim();
          val = val.replace(/^```(?:html|css|js|json|php|txt|markdown)?\s*\n(.*?)\n```$/s, '$1');
          result.fields[key] = val;
        }
      }
      result.message = extractHeadingLine(block, "message");
      return result;
    }

    // Check for # REPLY_TO_USER
    const replyMatch = text.match(/#\s*REPLY_TO_USER\n(.*)/s);
    if (replyMatch) {
        result.type = "REPLY";
        result.content = replyMatch[1].trim();
    }

    return result;
  }
}
