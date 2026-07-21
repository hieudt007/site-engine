import fs from "node:fs/promises";
import path from "node:path";
import CleanCSS from "clean-css";
import { minify as minifyJs } from "terser";
import { THEME_FILE_CONTRACTS } from "./themeContract.js";

const THEMES_ROOT = path.join(process.cwd(), "themes");

// Gom TOAN BO file nguon CSS/JS rieng-tung-trang (assets/sources/{ten}.css|js, 1 cap cho moi file
// trong THEME_FILE_CONTRACTS) thanh 2 file build DUY NHAT ma layout.liquid thuc su load
// (assets/custom.css/js) - minify + bo comment de nhung vao site. Goi lai ham nay moi khi 1 file
// nguon CSS/JS bi doi (xem routes/admin/themeChat.ts). File nguon nao chua ton tai/rong thi bo
// qua, khong loi.
export async function rebuildThemeAssets(slug: string): Promise<void> {
  const themeDir = path.join(THEMES_ROOT, slug);
  const sourcesDir = path.join(themeDir, "assets", "sources");

  const cssParts: string[] = [];
  const jsParts: string[] = [];

  for (const contract of THEME_FILE_CONTRACTS) {
    const base = contract.file.replace(/\.liquid$/, "");
    const css = await fs.readFile(path.join(sourcesDir, `${base}.css`), "utf-8").catch(() => "");
    const js = await fs.readFile(path.join(sourcesDir, `${base}.js`), "utf-8").catch(() => "");
    if (css.trim()) cssParts.push(css);
    if (js.trim()) jsParts.push(js);
  }

  const combinedCss = cssParts.join("\n");
  const minifiedCss = combinedCss.trim() ? new CleanCSS({}).minify(combinedCss).styles : "";
  await fs.writeFile(path.join(themeDir, "assets", "custom.css"), minifiedCss, "utf-8");

  const combinedJs = jsParts.join(";\n");
  let minifiedJs = "";
  if (combinedJs.trim()) {
    const result = await minifyJs(combinedJs, { compress: true, mangle: true });
    minifiedJs = result.code ?? "";
  }
  await fs.writeFile(path.join(themeDir, "assets", "custom.js"), minifiedJs, "utf-8");
}
