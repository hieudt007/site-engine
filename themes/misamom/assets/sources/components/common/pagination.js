document.addEventListener('DOMContentLoaded', () => {
    const paginationContainer = document.querySelector('.pagination-container');
    if (!paginationContainer) return;

    // Sử dụng Intersection Observer để kích hoạt animation khi cuộn tới component
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animation = 'paginationFadeUp 0.8s cubic-bezier(0.19, 1, 0.22, 1) forwards';
                observer.unobserve(entry.target);
            }
        });
    }, {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    });

    observer.observe(paginationContainer);
});