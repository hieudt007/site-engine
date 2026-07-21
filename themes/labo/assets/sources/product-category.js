// JS riêng cho product-category.liquid
document.addEventListener('DOMContentLoaded', () => {
    // 1. Định dạng giá tiền (thêm dấu phẩy)
    const priceElements = document.querySelectorAll('.category-product-price');
    priceElements.forEach(el => {
        const priceAttr = el.getAttribute('data-price');
        if (priceAttr) {
            const price = parseFloat(priceAttr);
            if (!isNaN(price)) {
                el.textContent = new Intl.NumberFormat('vi-VN').format(price) + '₫';
            }
        }
    });

    // 2. Hiệu ứng fade-in tuần tự cho các thẻ sản phẩm khi cuộn chuột
    const cards = document.querySelectorAll('.category-product-card');
    if (cards.length > 0) {
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry, index) => {
                if (entry.isIntersecting) {
                    // Tạo độ trễ (delay) dựa trên thứ tự xuất hiện
                    setTimeout(() => {
                        entry.target.classList.remove('opacity-0', 'translate-y-4');
                        entry.target.classList.add('opacity-100', 'translate-y-0');
                    }, index * 100); 
                    // Ngừng theo dõi sau khi đã hiển thị
                    observer.unobserve(entry.target);
                }
            });
        }, observerOptions);

        cards.forEach(card => {
            observer.observe(card);
        });
    }
});