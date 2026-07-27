import fs from "node:fs/promises";
import path from "node:path";
import { MCPTool } from "../core/ToolRegistry.js";
import { AgentContext } from "../core/BaseAgent.js";
import { getSelectableFiles } from "../../services/themeContract.js";
import { applyReplacements, retryUntilValid } from "../../services/themeChat.js";
import { validateThemeFile } from "../../services/themeValidator.js";

// Cac tool doc/ghi file cho DEVELOPER agent — pham vi ghi bi khoa cung vao 1 trong 2 "khong gian"
// duoc xac dinh boi context.meta (Theme / Landing Page), khong bao gio ra ngoai process.cwd().
// filename luon phai qua validateFile() (chan ".." + whitelist duoi file) TRUOC khi build path —
// khong duoc goi getSecurePath() truc tiep voi filename chua kiem tra.
// (Truoc day co them "khong gian" Plugin (addons/<slug>/views/...) - da bo cung luc go bo he
// thong plugin dong (chay code khong sandbox, xem lich su commit).)
function getSecurePath(context: AgentContext, filename: string): string {
  const { themeSlug, landingPageSlug } = context.meta;

  if (themeSlug) {
    return path.join(process.cwd(), "themes", themeSlug, filename);
  }
  if (landingPageSlug) {
    return path.join(process.cwd(), "storage", "landing-pages", landingPageSlug, filename);
  }
  throw new Error("Could not resolve slug (Theme/Landing).");
}

// Chan path traversal (".." trong filename thoat khoi thu muc goc du path.join co the resolve
// nguoc ra ngoai) + chi cho phep dung duoi file lien quan giao dien - KHONG cho .ts/.env/... —
// goi TRUOC moi lan doc/ghi, khong duoc bo qua o bat ky nhanh nao.
async function validateFile(context: AgentContext, filename: string): Promise<string | null> {
  if (filename.includes("..") || !/\.(liquid|css|js|html)$/.test(filename)) {
    return `Security error: file "${filename}" is invalid.`;
  }
  const themeSlug = context.meta.themeSlug;
  if (themeSlug) {
    const selectable = await getSelectableFiles(themeSlug);
    if (!selectable.has(filename)) {
      return `Error: file "${filename}" is not accessible in this Theme.`;
    }
  }
  return null;
}

export const listFilesTool: MCPTool = {
  name: "list_files",
  description: "List all .liquid/.css/.js files in the current Theme. No params needed.",
  isSystem: true,
  execute: async (_args, context) => {
    const themeSlug = context.meta.themeSlug;
    if (!themeSlug) return "Error: list_files only fully supports the current Theme.";
    const files = await getSelectableFiles(themeSlug);
    return `LIST_FILES:\n${Array.from(files).join("\n")}`;
  },
};

export const readFilesTool: MCPTool = {
  name: "read_files",
  description: 'Read content of one or more files. {"files": ["path1", "path2"]}',
  isSystem: true,
  execute: async (args, context) => {
    const files = args.files;
    if (!Array.isArray(files) || files.length === 0) return "Error: missing files (array).";

    let result = "";
    for (const file of files) {
      const err = await validateFile(context, file);
      if (err) {
        result += `${err}\n`;
        continue;
      }
      try {
        const content = await fs.readFile(getSecurePath(context, file), "utf-8");
        result += `--- File opened: ${file} ---\n${content}\n\n`;
      } catch {
        result += `Error reading file "${file}".\n`;
      }
    }
    return result || "No file could be read.";
  },
};

export const searchCodeTool: MCPTool = {
  name: "search_code",
  description: 'Search a string across all files in the Theme. {"query": "keyword"}',
  isSystem: true,
  execute: async (args, context) => {
    const query = (args.query || "").toLowerCase();
    if (!query) return "Error: missing query.";
    const themeSlug = context.meta.themeSlug;
    if (!themeSlug) return "Error: search_code currently only supports Theme.";

    const matchedFiles: string[] = [];
    const selectable = await getSelectableFiles(themeSlug);
    for (const f of selectable) {
      try {
        const content = await fs.readFile(getSecurePath(context, f), "utf-8");
        if (content.toLowerCase().includes(query)) matchedFiles.push(f);
      } catch {}
    }
    return `SEARCH_CODE [${query}]: found in files: ${matchedFiles.join(", ")}`;
  },
};

export const replaceCodeTool: MCPTool = {
  name: "replace_code",
  description:
    'Edit part of a file via find/replace (must read_files it first). {"file": "path", "blocks": [{"original": "...", "replacement": "..."}], "aiNotes": "optional"}',
  isSystem: true,
  execute: async (args, context) => {
    const file = args.file;
    const blocks = args.blocks || [];
    const aiNotes = args.aiNotes || "";
    if (!file || !Array.isArray(blocks) || blocks.length === 0) return "Error: missing file or blocks.";

    const validationErr = await validateFile(context, file);
    if (validationErr) return validationErr;

    const themeSlug = context.meta.themeSlug;
    const targetPath = getSecurePath(context, file);
    let currentContent: string;
    try {
      currentContent = await fs.readFile(targetPath, "utf-8");
    } catch {
      return `Error: you must read_files "${file}" first (or the file doesn't exist).`;
    }

    let updatedCommentBlock = "";
    if (themeSlug && file.endsWith(".liquid")) {
      const commentMatch = currentContent.match(/^\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}\n*/i);
      if (commentMatch) {
        let inner = commentMatch[1];
        if (aiNotes) {
          inner = inner.includes("@notes:")
            ? inner.replace(/@notes:\s*(.*)/, `@notes: ${aiNotes}`)
            : inner.trimEnd() + `\n@notes: ${aiNotes}\n`;
        }
        updatedCommentBlock = `{% comment %}${inner}{% endcomment %}\n`;
      }
    }

    const { success, newContent: replaced, errors } = applyReplacements(currentContent, blocks);
    if (!success) return `REPLACE_CODE FAILED: ${errors.join("; ")}`;
    let newContent = replaced;

    if (updatedCommentBlock && file.endsWith(".liquid")) {
      newContent = newContent.replace(/^\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}\n*/i, updatedCommentBlock);
    }

    if (themeSlug && file.endsWith(".liquid")) {
      const validation = await validateThemeFile(themeSlug, file, newContent);
      if (!validation.ok) {
        const agent = context.agentModel;
        const retryResult = agent
          ? await retryUntilValid(themeSlug, agent, file, newContent, validation.errors)
          : { ok: false, errors: validation.errors };
        if (!retryResult.ok) {
          return `CRITICAL VALIDATION ERROR: ${retryResult.errors.join("; ")}. Update CANCELLED.`;
        }
        newContent = retryResult.content || newContent;
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, newContent, "utf-8");
    return `REPLACE_CODE succeeded for file [${file}].`;
  },
};

export const overwriteFileTool: MCPTool = {
  name: "overwrite_file",
  description: 'Overwrite the entire content of 1 file. {"file": "path", "content": "...", "aiNotes": "optional"}',
  isSystem: true,
  execute: async (args, context) => {
    const file = args.file;
    let newContent = args.content;
    const aiNotes = args.aiNotes || "";
    if (!file || newContent === undefined) return "Error: missing file or content.";

    const validationErr = await validateFile(context, file);
    if (validationErr) return validationErr;

    const themeSlug = context.meta.themeSlug;
    const targetPath = getSecurePath(context, file);
    let currentContent = "";
    try {
      currentContent = await fs.readFile(targetPath, "utf-8");
    } catch {}

    let updatedCommentBlock = "";
    if (themeSlug && file.endsWith(".liquid") && currentContent) {
      const commentMatch = currentContent.match(/^\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}\n*/i);
      if (commentMatch) {
        let inner = commentMatch[1];
        if (aiNotes) {
          inner = inner.includes("@notes:")
            ? inner.replace(/@notes:\s*(.*)/, `@notes: ${aiNotes}`)
            : inner.trimEnd() + `\n@notes: ${aiNotes}\n`;
        }
        updatedCommentBlock = `{% comment %}${inner}{% endcomment %}\n`;
      }
    }

    if (updatedCommentBlock && file.endsWith(".liquid")) {
      newContent = newContent.replace(/^\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}\n*/i, "");
      newContent = updatedCommentBlock + newContent;
    }

    if (themeSlug && file.endsWith(".liquid")) {
      const validation = await validateThemeFile(themeSlug, file, newContent);
      if (!validation.ok) {
        const agent = context.agentModel;
        const retryResult = agent
          ? await retryUntilValid(themeSlug, agent, file, newContent, validation.errors)
          : { ok: false, errors: validation.errors };
        if (!retryResult.ok) {
          return `CRITICAL VALIDATION ERROR: ${retryResult.errors.join("; ")}. Update CANCELLED.`;
        }
        newContent = retryResult.content || newContent;
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, newContent, "utf-8");
    return `OVERWRITE_FILE succeeded for file [${file}].`;
  },
};
