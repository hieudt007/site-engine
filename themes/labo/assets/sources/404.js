// JS riêng cho 404.liquid
document.addEventListener('DOMContentLoaded', () => {
    // Ghi nhận lỗi 404 vào console để dễ dàng debug
    const path = window.location.pathname;
    console.warn(`[404 Not Found] Đường dẫn không tồn tại: ${path}`);
});