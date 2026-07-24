import fs from "node:fs/promises";
import path from "node:path";
import CleanCSS from "clean-css";
import { minify as minifyJs } from "terser";

const ADDONS_ROOT = path.join(process.cwd(), "src", "addons");

export async function buildAllPluginAssets(): Promise<void> {
  try {
    const addons = await fs.readdir(ADDONS_ROOT, { withFileTypes: true });
    for (const addon of addons) {
      if (!addon.isDirectory()) continue;
      const assetsDir = path.join(ADDONS_ROOT, addon.name, "assets");
      try {
        const files = await fs.readdir(assetsDir);
        for (const file of files) {
          if (file.includes(".min.")) continue; // Bỏ qua file đã minify
          
          const fullPath = path.join(assetsDir, file);
          const content = await fs.readFile(fullPath, "utf-8");
          let minified = "";
          let minFileName = "";
          
          if (file.endsWith(".css")) {
            minified = content.trim() ? new CleanCSS({}).minify(content).styles : "";
            minFileName = file.replace(/\.css$/, ".min.css");
          } else if (file.endsWith(".js")) {
            if (content.trim()) {
              const result = await minifyJs(content, { compress: true, mangle: true });
              minified = result.code ?? "";
            }
            minFileName = file.replace(/\.js$/, ".min.js");
          } else {
            continue;
          }
          
          const minFullPath = path.join(assetsDir, minFileName);
          let existing = "";
          try {
            existing = await fs.readFile(minFullPath, "utf-8");
          } catch (e) {
            // chưa tồn tại
          }
          
          // Chỉ ghi nếu có thay đổi để tránh vòng lặp vô tận của watcher
          if (existing !== minified) {
            await fs.writeFile(minFullPath, minified, "utf-8");
            console.log(`[PluginAsset] Minified ${addon.name}/${file} -> ${minFileName}`);
          }
        }
      } catch (e) {
        // Có thể addon không có thư mục assets
      }
    }
  } catch (err) {
    console.error("Error building plugin assets:", err);
  }
}

export function watchPluginAssets() {
  if (process.env.NODE_ENV === "production") return;
  import("node:fs").then((m) => {
    let timeout: NodeJS.Timeout;
    m.watch(ADDONS_ROOT, { recursive: true }, (eventType, filename) => {
      if (!filename || filename.includes(".min.")) return;
      if (filename.endsWith(".css") || filename.endsWith(".js")) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          buildAllPluginAssets().catch(console.error);
        }, 500);
      }
    });
  }).catch(() => {});
}
