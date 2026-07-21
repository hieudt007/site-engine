document.addEventListener('DOMContentLoaded', () => {
    // Định dạng lại giá tiền
    const priceElements = document.querySelectorAll('.order-price-display');
    
    priceElements.forEach(el => {
        const rawPrice = el.getAttribute('data-price');
        if (rawPrice && !isNaN(rawPrice)) {
            // Format theo chuẩn VNĐ
            const formattedPrice = new Intl.NumberFormat('vi-VN').format(rawPrice) + '₫';
            el.textContent = formattedPrice;
        }
    });
});