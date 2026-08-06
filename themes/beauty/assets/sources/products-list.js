// JS riêng cho products-list.liquid - Organic Biophilic Features

document.addEventListener('DOMContentLoaded', () => {
    // 1. Xử lý Mobile Filter Drawer
    const openFilterBtn = document.getElementById('pl-open-filter-btn');
    const closeFilterBtn = document.getElementById('pl-close-filter-btn');
    const filterSidebar = document.getElementById('pl-filter-sidebar');
    const filterOverlay = document.getElementById('pl-mobile-filter-overlay');

    const toggleFilter = (show) => {
        if (!filterSidebar || !filterOverlay) return;
        
        if (show) {
            filterOverlay.classList.remove('hidden');
            // Trigger reflow
            void filterOverlay.offsetWidth;
            filterOverlay.classList.remove('opacity-0');
            filterSidebar.classList.remove('-translate-x-full');
            document.body.classList.add('pl-overflow-hidden');
        } else {
            filterOverlay.classList.add('opacity-0');
            filterSidebar.classList.add('-translate-x-full');
            document.body.classList.remove('pl-overflow-hidden');
            
            // Wait for transition end before hiding overlay
            setTimeout(() => {
                filterOverlay.classList.add('hidden');
            }, 500); // Changed to match duration-500
        }
    };

    if (openFilterBtn) {
        openFilterBtn.addEventListener('click', () => toggleFilter(true));
    }

    if (closeFilterBtn) {
        closeFilterBtn.addEventListener('click', () => toggleFilter(false));
    }

    if (filterOverlay) {
        filterOverlay.addEventListener('click', () => toggleFilter(false));
    }

    // 2. Xử lý Intersection Observer cho hiệu ứng Fade-up
    const fadeElements = document.querySelectorAll('.pl-fade-up');
    
    const fadeObserverOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const fadeObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                // Thêm delay nhẹ cho các phần tử dạng grid để tạo hiệu ứng cascade
                if (entry.target.classList.contains('pl-product-card')) {
                    setTimeout(() => {
                        entry.target.classList.add('is-visible');
                    }, (index % 3) * 150); // Slightly slower cascade for organic feel
                } else {
                    entry.target.classList.add('is-visible');
                }
                observer.unobserve(entry.target);
            }
        });
    }, fadeObserverOptions);

    fadeElements.forEach(el => fadeObserver.observe(el));

    // 3. Xử lý logic Sắp xếp (Sort) giả lập
    const sortSelect = document.getElementById('pl-sort-by');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            const selectedSort = e.target.value;
            console.log('Sort changed to:', selectedSort);
            // window.location.search = `?sort=${selectedSort}`;
        });
    }

    // 4. Hiệu ứng bay vào giỏ hàng (Flying Cart Animation)
    const addToCartBtns = document.querySelectorAll('.pl-add-to-cart-btn');
    
    const CART_KEY = 'site_engine_cart';

    function addProductToCart(productId) {
        let cart;
        try {
            cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
        } catch {
            cart = [];
        }
        const existing = cart.find((c) => c.productId === productId && !c.variantId);
        if (existing) {
            existing.quantity += 1;
        } else {
            cart.push({ productId, quantity: 1 });
        }
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        window.dispatchEvent(new Event('cartUpdated'));
    }

    addToCartBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault(); // Ngăn chặn hành vi mặc định nếu cần

            const productId = this.getAttribute('data-product-id');
            if (productId) addProductToCart(productId);

            const imgUrl = this.getAttribute('data-image');
            if (!imgUrl) return;

            const card = this.closest('.pl-product-card');
            const img = card.querySelector('img');
            if (!img) return;

            // Lấy vị trí của ảnh gốc
            const rect = img.getBoundingClientRect();
            
            // Tạo phần tử bay
            const clone = document.createElement('div');
            clone.classList.add('pl-flying-item');
            clone.style.position = 'fixed';
            clone.style.top = rect.top + 'px';
            clone.style.left = rect.left + 'px';
            clone.style.width = rect.width + 'px';
            clone.style.height = rect.height + 'px';
            clone.style.backgroundImage = `url(${imgUrl})`;
            clone.style.backgroundSize = 'cover';
            clone.style.backgroundPosition = 'center';
            clone.style.borderRadius = '24px'; // Match card radius initially
            clone.style.zIndex = '9999';
            clone.style.transition = 'all 0.8s cubic-bezier(0.25, 1, 0.5, 1)'; // Smooth organic curve
            
            document.body.appendChild(clone);

            const cartIcon = document.getElementById('cart-icon');
            
            // Vị trí mặc định nếu không tìm thấy giỏ hàng (góc trên phải)
            let targetX = window.innerWidth - 60;
            let targetY = 20;

            if (cartIcon) {
                const cartRect = cartIcon.getBoundingClientRect();
                // Tính tâm của icon giỏ hàng
                targetX = cartRect.left + (cartRect.width / 2) - 15;
                targetY = cartRect.top + (cartRect.height / 2) - 15;
            }

            // Kích hoạt animation ở frame tiếp theo để trình duyệt kịp render vị trí ban đầu
            requestAnimationFrame(() => {
                clone.style.top = targetY + 'px';
                clone.style.left = targetX + 'px';
                clone.style.width = '30px';
                clone.style.height = '30px';
                clone.style.opacity = '0.3';
                clone.style.borderRadius = '50%'; // Biến thành hình tròn khi bay
                clone.style.transform = 'scale(0.5)';
            });

            // Xóa phần tử sau khi bay xong
            setTimeout(() => {
                clone.remove();
                
                // Hiệu ứng rung nhẹ giỏ hàng (tùy chọn)
                if (cartIcon) {
                    cartIcon.style.transform = 'scale(1.2)';
                    cartIcon.style.transition = 'transform 0.2s ease';
                    setTimeout(() => {
                        cartIcon.style.transform = 'scale(1)';
                    }, 200);
                }
            }, 800);
        });
    });
});