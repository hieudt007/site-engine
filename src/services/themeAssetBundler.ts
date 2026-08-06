import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import CleanCSS from "clean-css";
import { minify as minifyJs } from "terser";
import { getAllContracts } from "./themeContract.js";

const execAsync = promisify(exec);

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

  const contracts = await getAllContracts(slug);
  for (const contract of contracts) {
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

  // Tailwind CSS Compilation
  const layoutPath = path.join(themeDir, "layout.liquid");
  const layoutContent = await fs.readFile(layoutPath, "utf-8").catch(() => "");
  
  // Trích xuất tailwind.config (dù là thẻ script cũ hay thẻ application/json mới)
  const match = layoutContent.match(/tailwind\.config\s*=\s*(\{[\s\S]*?\})\s*<\/script>/) || 
                layoutContent.match(/<script type="application\/json" id="tailwind-config">\s*(\{[\s\S]*?\})\s*<\/script>/);
  
  const configStr = match ? match[1] : "{}";
  
  const tailwindConfigPath = path.join(themeDir, "tailwind.config.mjs");
  const tailwindInputCss = path.join(themeDir, "assets", "tailwind-input.css");
  const tailwindOutputCss = path.join(themeDir, "assets", "tailwind-compiled.css");
  
  // Tạo tailwind.config.mjs dynamically
  await fs.writeFile(tailwindConfigPath, `
export default {
  content: ["./**/*.liquid", "./assets/**/*.js"],
  ...${configStr}
};
  `, "utf-8");

  // Tạo tailwind-input.css nếu chưa có
  const inputCssExists = await fs.access(tailwindInputCss).then(() => true).catch(() => false);
  if (!inputCssExists) {
    await fs.writeFile(tailwindInputCss, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`, "utf-8");
  }

  // Chạy trình biên dịch Tailwind
  try {
    await execAsync(`npx tailwindcss -c ${tailwindConfigPath} -i ${tailwindInputCss} -o ${tailwindOutputCss} --minify`, { cwd: themeDir });
  } catch (error) {
    console.error(`Tailwind compilation failed for theme ${slug}:`, error);
  }
}
