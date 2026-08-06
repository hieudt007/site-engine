// JS riêng cho 404.liquid
document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer cho hiệu ứng fade-up
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Thêm delay nhẹ để hiệu ứng trông mượt hơn khi load trang
                setTimeout(() => {
                    entry.target.classList.add('is-visible');
                }, 100);
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const fadeElements = document.querySelectorAll('.fade-up-element');
    fadeElements.forEach(el => observer.observe(el));
});