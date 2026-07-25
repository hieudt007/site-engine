import fs from "node:fs/promises";
import path from "node:path";

export interface ThemeFileContract {
  file: string;
  description: string;
  contextVars: string;
  responsibilities: string;
  structureRules: string;
  requiredSubstrings: string[];
  requiredIds: string[];
  notes: string;
}

export const CORE_THEME_FILES = [
  "layout.liquid", "header.liquid", "footer.liquid", "home.liquid",
  "blog-list.liquid", "blog-post.liquid", "blog-category.liquid", "blog-post-locked.liquid",
  "page.liquid", "products-list.liquid", "product-category.liquid", "search.liquid",
  "product-detail.liquid", "components/product/media.liquid", "components/product/info.liquid",
  "components/product/purchase.liquid", "components/product/content.liquid",
  "components/product/related.liquid", "components/common/cart-drawer.liquid",
  "checkout.liquid", "order-confirmation.liquid", "404.liquid", "custom-fields.liquid",
  "components/common/breadcrumb.liquid", "components/common/pagination.liquid",
  "components/product/card.liquid", "components/post/card.liquid"
];

// Parse contract from liquid file comment
export function parseContractFromLiquid(content: string, filename: string): ThemeFileContract | undefined {
  const commentMatch = content.match(/\{%\s*comment\s*%\}([\s\S]*?)\{%\s*endcomment\s*%\}/i);
  if (!commentMatch) return undefined;

  const comment = commentMatch[1];
  
  const descMatch = comment.match(/@description:\s*(.*)/);
  const contextVarsMatch = comment.match(/@context_vars:\s*(.*)/);
  const respMatch = comment.match(/@responsibilities:\s*(.*)/);
  const structMatch = comment.match(/@structure_rules:\s*(.*)/);
  const subsMatch = comment.match(/@required_substrings:\s*(.*)/);
  const idsMatch = comment.match(/@required_ids:\s*(.*)/);
  const notesMatch = comment.match(/@notes:\s*(.*)/);

  if (!descMatch) return undefined;

  return {
    file: filename,
    description: descMatch[1].trim(),
    contextVars: contextVarsMatch && contextVarsMatch[1].trim() ? contextVarsMatch[1].trim() : "",
    responsibilities: respMatch && respMatch[1].trim() ? respMatch[1].trim() : "",
    structureRules: structMatch && structMatch[1].trim() ? structMatch[1].trim() : "",
    requiredSubstrings: subsMatch && subsMatch[1].trim() ? subsMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [],
    requiredIds: idsMatch && idsMatch[1].trim() ? idsMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [],
    notes: notesMatch && notesMatch[1].trim() ? notesMatch[1].trim() : ""
  };
}

export async function getContractFromDisk(themeSlug: string, filename: string): Promise<ThemeFileContract | undefined> {
  const filePath = path.join(process.cwd(), "themes", themeSlug, filename);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return parseContractFromLiquid(content, filename);
  } catch (e) {
    return undefined;
  }
}

export async function getAllContracts(themeSlug: string): Promise<ThemeFileContract[]> {
  const contracts: ThemeFileContract[] = [];
  const themeDir = path.join(process.cwd(), "themes", themeSlug);
  
  async function scanDir(dir: string, base: string = "") {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = base ? `${base}/${entry.name}` : entry.name;
      
      // Keep forward slashes for cross-platform consistency
      const normalizedPath = relativePath.replace(/\\/g, '/');

      if (entry.isDirectory() && entry.name !== "assets") {
        await scanDir(fullPath, normalizedPath);
      } else if (entry.isFile() && entry.name.endsWith(".liquid")) {
        const content = await fs.readFile(fullPath, "utf-8");
        const contract = parseContractFromLiquid(content, normalizedPath);
        if (contract) {
          contracts.push(contract);
        } else {
          contracts.push({
            file: normalizedPath,
            description: "File tùy chỉnh",
            contextVars: "",
            responsibilities: "",
            structureRules: "",
            requiredSubstrings: [],
            requiredIds: [],
            notes: ""
          });
        }
      }
    }
  }
  
  await scanDir(themeDir);
  return contracts;
}

export interface ThemeAssetFile {
  file: string;
  contentType: "css" | "js";
  forLiquidFile: string;
  notes: string;
}

function sourceBase(liquidFile: string): string {
  return liquidFile.replace(/\.liquid$/, "");
}

export function pairedSourceFiles(liquidFile: string): { css: string; js: string } {
  const base = sourceBase(liquidFile);
  return { css: `assets/sources/${base}.css`, js: `assets/sources/${base}.js` };
}

export async function getAllThemeAssetFiles(themeSlug: string): Promise<ThemeAssetFile[]> {
  const contracts = await getAllContracts(themeSlug);
  return contracts.flatMap((c) => {
    const { css, js } = pairedSourceFiles(c.file);
    return [
      { file: css, contentType: "css" as const, forLiquidFile: c.file, notes: `CSS riêng cho "${c.file}" (${c.description}) — chỉ ảnh hưởng trang này.` },
      {
        file: js,
        contentType: "js" as const,
        forLiquidFile: c.file,
        notes:
          `JS riêng cho "${c.file}" (${c.description}) — chỉ ảnh hưởng trang này. KHÔNG được định nghĩa lại các id ` +
          "đã dùng bởi JS nguồn của theme: add-to-cart, " +
          "cart-drawer-items, checkout-items, checkout-form, checkout-error, checkout-total, cart-drawer-total, variant-picker, variant-price, variant-stock, " +
          "review-form, unlock-form, password, unlock-error.",
      },
    ];
  });
}

export const THEME_BUNDLE_OUTPUTS = ["assets/custom.css", "assets/custom.js"];

export async function getSelectableFiles(themeSlug: string): Promise<Set<string>> {
  const contracts = await getAllContracts(themeSlug);
  const assets = await getAllThemeAssetFiles(themeSlug);
  return new Set([...contracts.map((c) => c.file), ...assets.map((a) => a.file)]);
}

export async function getViewableFiles(themeSlug: string): Promise<Set<string>> {
  const selectable = await getSelectableFiles(themeSlug);
  return new Set([...Array.from(selectable), ...THEME_BUNDLE_OUTPUTS]);
}

export function pageGroupKey(file: string): string {
  if (file.startsWith("assets/sources/")) {
    return file.replace(/^assets\/sources\//, "").replace(/\.(css|js)$/, "");
  }
  return file.replace(/\.liquid$/, "");
}
