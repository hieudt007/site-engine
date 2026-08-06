document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer để kích hoạt hiệu ứng fade-up khi scroll
    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Ngừng quan sát sau khi đã hiện để tối ưu hiệu suất
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Bắt đầu quan sát tất cả các phần tử có class fade-up-item
    const animatedElements = document.querySelectorAll('.fade-up-item');
    animatedElements.forEach((el) => {
        observer.observe(el);
    });
});