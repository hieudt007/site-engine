document.addEventListener('DOMContentLoaded', () => {
    const customFieldRows = document.querySelectorAll('.custom-field-row');
    if (!customFieldRows.length) return;

    // Sử dụng Intersection Observer để tạo hiệu ứng xuất hiện tuần tự (staggered fade-up)
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -10px 0px'
    };

    const fieldObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const row = entry.target;
                // Tính toán độ trễ dựa trên vị trí của dòng trong danh sách
                const index = Array.from(customFieldRows).indexOf(row);
                
                setTimeout(() => {
                    row.classList.add('is-visible');
                }, index * 80); // Khoảng cách xuất hiện mượt mà
                
                observer.unobserve(row);
            }
        });
    }, observerOptions);

    customFieldRows.forEach(row => fieldObserver.observe(row));
});