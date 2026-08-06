// JS riêng cho page.liquid

document.addEventListener('DOMContentLoaded', () => {
    // 1. Hiệu ứng fade-up và blur-out mượt mà cho các phần tử bên trong nội dung khi cuộn
    const contentElements = document.querySelectorAll('.page-content-wrapper > *');
    
    // Cấu hình Intersection Observer
    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const scrollObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Thêm class để hiện phần tử và bỏ blur
                entry.target.classList.add('opacity-100', 'translate-y-0', 'blur-none');
                entry.target.classList.remove('opacity-0', 'translate-y-8', 'blur-sm');
                
                // Ngừng theo dõi sau khi đã hiện
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Khởi tạo các phần tử: ẩn đi, thêm blur và transition
    contentElements.forEach((el, index) => {
        // Bỏ qua các phần tử rỗng hoặc hr
        if (el.tagName === 'HR' || el.textContent.trim() === '' && el.tagName !== 'IMG' && el.tagName !== 'FIGURE') return;

        // Thêm class khởi tạo
        el.classList.add('transition-all', 'duration-1000', 'ease-[cubic-bezier(0.22,1,0.36,1)]', 'opacity-0', 'translate-y-8', 'blur-sm', 'will-change-[opacity,transform,filter]');
        
        // Tạo độ trễ nhẹ giữa các phần tử liên tiếp để tạo hiệu ứng dòng chảy
        const delay = (index % 3) * 150; 
        el.style.transitionDelay = `${delay}ms`;

        // Bắt đầu theo dõi
        scrollObserver.observe(el);
    });

    // 2. Thêm hiệu ứng hover cao cấp cho hình ảnh trong bài
    const images = document.querySelectorAll('.page-content-wrapper img');
    images.forEach(img => {
        img.classList.add('transition-all', 'duration-700', 'ease-out', 'hover:scale-[1.02]', 'hover:shadow-[0_20px_50px_-10px_rgba(5,150,105,0.15)]');
    });
});