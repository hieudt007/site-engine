import { renderPublic } from "./themeRenderer.js";

// 404 theo dung theme dang active (thay vi HTML thuan cung tung noi) - dung chung cho moi route
// public tra 404 that (slug/id khong ton tai). "message" tuy chon de giu duoc ngu canh cu the
// (vd "Không tìm thấy bài viết" khac "Không tìm thấy danh mục") - themes/*/404.liquid tu fallback
// khi khong truyen.
export async function renderNotFound(message?: string): Promise<string> {
  return renderPublic("404", { pageTitle: "Không tìm thấy trang", noindex: true, message });
}
