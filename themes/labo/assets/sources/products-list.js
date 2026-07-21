// JS riêng cho products-list.liquid
document.addEventListener('DOMContentLoaded', () => {
    // 1. Hiệu ứng fade-in mượt mà cho các thẻ sản phẩm
    const cards = document.querySelectorAll('.product-card');
    cards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.remove('opacity-0', 'translate-y-4');
        }, 50 * index); // Stagger effect: hiện lần lượt từng thẻ
    });

    // 2. Định dạng lại giá tiền có dấu phẩy (nếu dữ liệu gốc là số thô)
    const priceElements = document.querySelectorAll('.price-value');
    priceElements.forEach(el => {
        const text = el.textContent.trim();
        // Chỉ xử lý nếu chuỗi toàn số
        if (/^\d+$/.test(text)) {
            const num = parseInt(text, 10);
            el.textContent = new Intl.NumberFormat('vi-VN').format(num);
        }
    });
});