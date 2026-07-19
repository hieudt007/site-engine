import path from "node:path";
import { Liquid } from "liquidjs";

// Render trang HTML trong /admin (list bài viết, editor) — KHÔNG dùng theme (khác themeRenderer.ts
// vốn dành cho trang public, có thể đổi theo ThemeConfig.activeTheme). views/admin/ là thư mục
// cố định, đóng gói cùng dist/ khi build zip (scripts/build-release.sh).
const VIEWS_ROOT = path.join(process.cwd(), "views", "admin");
const engine = new Liquid({ root: VIEWS_ROOT, extname: ".liquid" });

export async function renderAdmin(template: string, data: Record<string, unknown>): Promise<string> {
  return engine.renderFile(template, data);
}
