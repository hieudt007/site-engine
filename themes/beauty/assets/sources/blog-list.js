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
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target); // Chỉ chạy 1 lần
            }
        });
    }, observerOptions);

    const fadeItems = document.querySelectorAll('.fade-up-item');
    fadeItems.forEach((item, index) => {
        // Thêm delay nhẹ cho các item trong grid để tạo hiệu ứng cascade
        if(item.tagName.toLowerCase() === 'article') {
            item.style.transitionDelay = `${(index % 3) * 0.1}s`;
        }
        observer.observe(item);
    });
});