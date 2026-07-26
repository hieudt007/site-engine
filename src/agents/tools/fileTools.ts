import fs from "node:fs/promises";
import path from "node:path";
import { MCPTool } from "../core/ToolRegistry.js";
import { AgentContext } from "../core/BaseAgent.js";
import { getSelectableFiles } from "../../services/themeContract.js";
import { applyReplacements, retryUntilValid } from "../../services/themeChat.js";
import { validateThemeFile } from "../../services/themeValidator.js";
import { findEnabledPlugin } from "../../services/pluginRuntime.js";

// Cac tool doc/ghi file cho DEVELOPER agent — pham vi ghi bi khoa cung vao 1 trong 3 "khong
// gian" duoc xac dinh boi context.meta (Theme / Landing Page / Plugin), khong bao gio ra ngoai
// process.cwd(). filename luon phai qua validateFile() (chan ".." + whitelist duoi file) TRUOC
// khi build path — khong duoc goi getSecurePath() truc tiep voi filename chua kiem tra.
// LUU Y: nhanh "pluginSlug" rieng (ghi thang vao goc thu muc plugin, ngoai addons/<slug>/views/)
// da bi loai bo - validateFile() gio bat buoc moi truy cap cua ngu canh plugin phai di qua tien
// to "addons/" (validateAddonFile, gioi han trong views/), nen ham nay chi con 3 "khong gian".
function getSecurePath(context: AgentContext, filename: string): string {
  const { themeSlug, landingPageSlug } = context.meta;

  if (filename.startsWith("addons/")) {
    return path.join(process.cwd(), "src", filename);
  }
  if (themeSlug) {
    return path.join(process.cwd(), "themes", themeSlug, filename);
  }
  if (landingPageSlug) {
    return path.join(process.cwd(), "storage", "landing-pages", landingPageSlug, filename);
  }
  throw new Error("Không xác định được slug (Theme/Landing/Plugin).");
}

// Chan path traversal (".." trong filename thoat khoi thu muc goc du path.join co the resolve
// nguoc ra ngoai) + chi cho phep dung duoi file lien quan giao dien - KHONG cho .ts/.env/... —
// goi TRUOC moi lan doc/ghi, khong duoc bo qua o bat ky nhanh nao.
//
// Nhanh "addons/": co lap GIUA CAC PLUGIN VOI NHAU, nhung Theme van duoc cham vao view cua plugin
// (dung nghiep vu: theme phai tich hop giao dien cho nhieu plugin cung luc, giong co che
// manifest.themeContracts). Cu the:
//   1. Phai nam trong "addons/<slug>/views/..." - khong dung toi file logic (backend/, install.ts,
//      manifest.json).
//   2. <slug> phai la 1 plugin THAT SU dang bat (findEnabledPlugin).
//   3. Neu ngu canh la CUA 1 PLUGIN (context.meta.pluginSlug, khong phai dang sua Theme) thi
//      <slug> BAT BUOC phai trung plugin do - khong dung cheo sang plugin khac. Ngu canh Theme
//      (context.meta.themeSlug) thi khong bi gioi han nay - duoc dung view cua bat ky plugin dang
//      bat nao.
async function validateAddonFile(context: AgentContext, filename: string): Promise<string | null> {
  const match = filename.match(/^addons\/([^/]+)\/views\//);
  if (!match) {
    return `Lỗi bảo mật, file "${filename}" không hợp lệ (chỉ được truy cập addons/<plugin>/views/...).`;
  }
  const targetSlug = match[1];

  if (!context.meta.themeSlug && context.meta.pluginSlug && context.meta.pluginSlug !== targetSlug) {
    return `Lỗi bảo mật, không được truy cập file của plugin khác ("${targetSlug}").`;
  }

  const plugin = await findEnabledPlugin(targetSlug);
  if (!plugin) {
    return `Lỗi, plugin "${targetSlug}" không tồn tại hoặc chưa được bật.`;
  }
  return null;
}

async function validateFile(context: AgentContext, filename: string): Promise<string | null> {
  if (filename.includes("..") || !/\.(liquid|css|js|html)$/.test(filename)) {
    return `Lỗi bảo mật, file "${filename}" không hợp lệ.`;
  }
  if (filename.startsWith("addons/")) {
    return validateAddonFile(context, filename);
  }
  // Ngu canh cua 1 PLUGIN (khong phai Theme) BAT BUOC dung duong dan dang "addons/<slug>/views/..."
  // - khong duoc dung filename "tron" (vd "backend/index.js"), vi nhanh do se lot qua het cac
  // check o tren va getSecurePath() se ghi thang vao goc thu muc plugin (ngoai views/, dung toi
  // ca file logic cua chinh no).
  if (context.meta.pluginSlug && !context.meta.themeSlug) {
    return `Lỗi bảo mật, chỉ được dùng đường dẫn dạng "addons/<slug>/views/..." cho file "${filename}".`;
  }
  const themeSlug = context.meta.themeSlug;
  if (themeSlug) {
    const selectable = await getSelectableFiles(themeSlug);
    if (!selectable.has(filename)) {
      return `Lỗi, file "${filename}" không được phép truy cập trong Theme.`;
    }
  }
  return null;
}

export const listFilesTool: MCPTool = {
  name: "list_files",
  description: "Liệt kê toàn bộ file .liquid/.css/.js hiện có trong Theme đang chỉnh sửa. Không cần tham số.",
  isSystem: true,
  execute: async (_args, context) => {
    const themeSlug = context.meta.themeSlug;
    if (!themeSlug) return "Lỗi: list_files chỉ hỗ trợ đầy đủ trên Theme hiện tại.";
    const files = await getSelectableFiles(themeSlug);
    return `LIST_FILES:\n${Array.from(files).join("\n")}`;
  },
};

export const readFilesTool: MCPTool = {
  name: "read_files",
  description: 'Đọc nội dung 1 hoặc nhiều file. Tham số: {"files": ["path1", "path2"]}',
  isSystem: true,
  execute: async (args, context) => {
    const files = args.files;
    if (!Array.isArray(files) || files.length === 0) return "Lỗi: Thiếu tham số files (array).";

    let result = "";
    for (const file of files) {
      const err = await validateFile(context, file);
      if (err) {
        result += `${err}\n`;
        continue;
      }
      try {
        const content = await fs.readFile(getSecurePath(context, file), "utf-8");
        result += `--- File đã mở: ${file} ---\n${content}\n\n`;
      } catch {
        result += `Lỗi khi đọc file "${file}".\n`;
      }
    }
    return result || "Không đọc được file nào.";
  },
};

export const searchCodeTool: MCPTool = {
  name: "search_code",
  description: 'Tìm chuỗi trong toàn bộ file của Theme. Tham số: {"query": "từ khoá"}',
  isSystem: true,
  execute: async (args, context) => {
    const query = (args.query || "").toLowerCase();
    if (!query) return "Lỗi: Thiếu query.";
    const themeSlug = context.meta.themeSlug;
    if (!themeSlug) return "Lỗi: search_code tạm thời chỉ hỗ trợ trên Theme.";

    const matchedFiles: string[] = [];
    const selectable = await getSelectableFiles(themeSlug);
    for (const f of selectable) {
      try {
        const content = await fs.readFile(getSecurePath(context, f), "utf-8");
        if (content.toLowerCase().includes(query)) matchedFiles.push(f);
      } catch {}
    }
    return `SEARCH_CODE [${query}]: Tìm thấy trong các file: ${matchedFiles.join(", ")}`;
  },
};

export const replaceCodeTool: MCPTool = {
  name: "replace_code",
  description:
    'Sửa 1 phần file bằng find/replace (phải read_files file đó trước). Tham số: {"file": "path", "blocks": [{"original": "...", "replacement": "..."}], "aiNotes": "tuỳ chọn"}',
  isSystem: true,
  execute: async (args, context) => {
    const file = args.file;
    const blocks = args.blocks || [];
    const aiNotes = args.aiNotes || "";
    if (!file || !Array.isArray(blocks) || blocks.length === 0) return "Lỗi: Thiếu tham số file hoặc blocks.";

    const validationErr = await validateFile(context, file);
    if (validationErr) return validationErr;

    const themeSlug = context.meta.themeSlug;
    const targetPath = getSecurePath(context, file);
    let currentContent: string;
    try {
      currentContent = await fs.readFile(targetPath, "utf-8");
    } catch {
      return `Lỗi, bạn phải read_files file "${file}" trước (hoặc file không tồn tại).`;
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
    if (!success) return `REPLACE_CODE THẤT BẠI: ${errors.join("; ")}`;
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
          return `LỖI VALIDATION NGHIÊM TRỌNG: ${retryResult.errors.join("; ")}. Cập nhật BỊ HỦY BỎ.`;
        }
        newContent = retryResult.content || newContent;
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, newContent, "utf-8");
    return `REPLACE_CODE thành công cho file [${file}].`;
  },
};

export const overwriteFileTool: MCPTool = {
  name: "overwrite_file",
  description: 'Ghi đè toàn bộ nội dung 1 file. Tham số: {"file": "path", "content": "...", "aiNotes": "tuỳ chọn"}',
  isSystem: true,
  execute: async (args, context) => {
    const file = args.file;
    let newContent = args.content;
    const aiNotes = args.aiNotes || "";
    if (!file || newContent === undefined) return "Lỗi: Thiếu file hoặc content.";

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
          return `LỖI VALIDATION NGHIÊM TRỌNG: ${retryResult.errors.join("; ")}. Cập nhật BỊ HỦY BỎ.`;
        }
        newContent = retryResult.content || newContent;
      }
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, newContent, "utf-8");
    return `OVERWRITE_FILE thành công cho file [${file}].`;
  },
};
