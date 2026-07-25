document.addEventListener('DOMContentLoaded', () => {
    const mainImage = document.getElementById('gallery-main-image');
    const thumbnails = document.querySelectorAll('.thumbnail-trigger');

    if (!mainImage || thumbnails.length === 0) return;

    thumbnails.forEach(thumbnail => {
        thumbnail.addEventListener('click', function() {
            const newImageUrl = this.getAttribute('data-image-url');

            // Bỏ qua nếu click vào ảnh đang hiển thị
            if (mainImage.src === newImageUrl) return;

            // 1. Cập nhật trạng thái active cho thumbnails
            thumbnails.forEach(t => {
                // Xóa trạng thái active cũ
                t.classList.remove('border-emerald-600', 'shadow-md', 'opacity-100');
                t.classList.add('border-transparent', 'opacity-60');
                const overlay = t.querySelector('.thumbnail-overlay');
                if(overlay) overlay.classList.remove('opacity-0');
            });

            // Thêm trạng thái active cho thumbnail vừa click
            this.classList.remove('border-transparent', 'opacity-60');
            this.classList.add('border-emerald-600', 'shadow-md', 'opacity-100');
            const activeOverlay = this.querySelector('.thumbnail-overlay');
            if(activeOverlay) activeOverlay.classList.add('opacity-0');

            // 2. Hiệu ứng đổi ảnh chính (Organic transition)
            mainImage.classList.add('image-transitioning');

            // Đợi CSS transition chạy một nửa rồi đổi source ảnh
            setTimeout(() => {
                mainImage.src = newImageUrl;
                
                // Sau khi ảnh đã load (hoặc bắt đầu load), xóa class hiệu ứng để hiện lại
                requestAnimationFrame(() => {
                    // Thêm một delay nhỏ để đảm bảo ảnh mới đã kịp render frame đầu tiên
                    setTimeout(() => {
                        mainImage.classList.remove('image-transitioning');
                    }, 50);
                });
            }, 300); // 300ms khớp với duration của transition
        });
    });
});