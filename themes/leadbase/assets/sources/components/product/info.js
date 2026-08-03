// Khối thông tin định danh sản phẩm hiện tại tĩnh, css đã xử lý animation fade-in tuần tự.
document.addEventListener('DOMContentLoaded', () => {
    // Đảm bảo animation chạy mượt mà khi DOM tải xong
    const header = document.querySelector('.product-info-header');
    if(header) {
        header.style.display = 'flex';
    }
});