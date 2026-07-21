document.addEventListener('DOMContentLoaded', () => {
    const cartItemsContainer = document.getElementById('cart-items');
    const emptyMessage = document.getElementById('empty-cart-message');

    if (cartItemsContainer && emptyMessage) {
        const checkEmptyState = () => {
            if (cartItemsContainer.innerHTML.trim() === '') {
                emptyMessage.classList.remove('hidden');
                cartItemsContainer.classList.add('hidden');
            } else {
                emptyMessage.classList.add('hidden');
                cartItemsContainer.classList.remove('hidden');
            }
        };

        // Chạy kiểm tra sau một khoảng trễ nhỏ để JS hệ thống kịp render items
        setTimeout(checkEmptyState, 200);

        // Lắng nghe sự thay đổi bên trong #cart-items để cập nhật trạng thái trống
        const observer = new MutationObserver(checkEmptyState);
        observer.observe(cartItemsContainer, { childList: true, subtree: true });
    }
});