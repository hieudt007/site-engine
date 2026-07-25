document.addEventListener('DOMContentLoaded', () => {
    const breadcrumbLists = document.querySelectorAll('.breadcrumb-container ol');

    breadcrumbLists.forEach(list => {
        // Tự động cuộn đến item cuối cùng (trang hiện tại) trên mobile nếu breadcrumb quá dài
        const scrollToActive = () => {
            if (list.scrollWidth > list.clientWidth) {
                // Sử dụng requestAnimationFrame để đảm bảo DOM đã render xong
                requestAnimationFrame(() => {
                    list.scrollTo({
                        left: list.scrollWidth,
                        behavior: 'smooth'
                    });
                });
            }
        };

        // Chạy khi tải trang
        scrollToActive();

        // Chạy lại khi xoay màn hình điện thoại
        window.addEventListener('orientationchange', () => {
            setTimeout(scrollToActive, 200);
        });
    });
});