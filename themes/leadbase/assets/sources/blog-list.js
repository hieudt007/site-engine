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

    // Xử lý active state cho category pills (UI demo)
    const categoryPills = document.querySelectorAll('.category-filters a');
    categoryPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            e.preventDefault();
            // Reset tất cả
            categoryPills.forEach(p => {
                p.classList.remove('bg-[#059669]', 'text-white');
                p.classList.add('bg-[#E8F1F3]', 'text-[#64748B]', 'hover:bg-[#A7F3D0]', 'hover:text-[#064E3B]');
            });
            // Set active cho phần tử được click
            e.target.classList.remove('bg-[#E8F1F3]', 'text-[#64748B]', 'hover:bg-[#A7F3D0]', 'hover:text-[#064E3B]');
            e.target.classList.add('bg-[#059669]', 'text-white');
        });
    });
});