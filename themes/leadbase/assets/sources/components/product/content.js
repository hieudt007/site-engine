document.addEventListener('DOMContentLoaded', () => {
    // 1. Tabs Logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    if (tabBtns.length > 0) {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Reset all buttons
                tabBtns.forEach(b => {
                    b.classList.remove('text-brand', 'border-brand');
                    b.classList.add('text-brand-dark/50', 'border-transparent');
                });
                
                // Hide all contents
                tabContents.forEach(c => {
                    c.classList.add('hidden');
                    c.classList.remove('animate-fade-up');
                });

                // Activate clicked button
                btn.classList.remove('text-brand-dark/50', 'border-transparent');
                btn.classList.add('text-brand', 'border-brand');
                
                // Show target content with animation
                const targetId = btn.getAttribute('data-target');
                const targetContent = document.getElementById(targetId);
                if (targetContent) {
                    targetContent.classList.remove('hidden');
                    // Force reflow to restart animation
                    void targetContent.offsetWidth;
                    targetContent.classList.add('animate-fade-up');
                }
            });
        });
    }

    // 1.5. Description "Doc them" toggle
    const descBox = document.getElementById('product-description-content');
    const descToggle = document.getElementById('product-description-toggle');
    const descFade = document.getElementById('product-description-fade');
    if (descBox && descToggle) {
        // Chi hien nut/fade neu noi dung thuc su dai hon max-height (khong thi bam vao khong lam gi ca)
        if (descBox.scrollHeight <= descBox.clientHeight) {
            descToggle.style.display = 'none';
            if (descFade) descFade.style.display = 'none';
        } else {
            let expanded = false;
            descToggle.addEventListener('click', () => {
                expanded = !expanded;
                descBox.classList.toggle('max-h-[420px]', !expanded);
                descBox.classList.toggle('overflow-hidden', !expanded);
                if (descFade) descFade.style.display = expanded ? 'none' : '';
                descToggle.querySelector('span').textContent = expanded ? 'Thu gọn' : 'Đọc thêm';
                descToggle.querySelector('svg').style.transform = expanded ? 'rotate(180deg)' : '';
            });
        }
    }

    // 1.55. Rating summary (components/product/info.liquid) - bam vao thi chuyen sang tab
    // "Danh gia" (tab-btn tuong ung) roi cuon xuong, vi phan nay nam duoi mo ta san pham rat dai.
    const ratingSummaryBtn = document.getElementById('product-rating-summary');
    if (ratingSummaryBtn) {
        ratingSummaryBtn.addEventListener('click', () => {
            const reviewsTabBtn = document.querySelector('.tab-btn[data-target="tab-reviews"]');
            if (reviewsTabBtn) {
                reviewsTabBtn.click();
                reviewsTabBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    // 1.6. FAQ Accordion Logic (components/product/faq.liquid - khong co file .js rieng vi
    // "faq" khong nam trong THEME_FILE_CONTRACTS co dinh cua he thong nen se khong bao gio duoc
    // bundle; gop logic vao day, script nay da chay tren moi trang chi tiet san pham).
    document.querySelectorAll('.product-faq-section .faq-question').forEach((btn) => {
        btn.addEventListener('click', () => {
            const answer = btn.nextElementSibling;
            const icon = btn.querySelector('.faq-icon');
            const isOpen = !answer.classList.contains('hidden');
            answer.classList.toggle('hidden', isOpen);
            if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
        });
    });

    // 2. Star Rating UI Logic
    const stars = document.querySelectorAll('.star-rating-ui span');
    const ratingInput = document.getElementById('real-rating-input');

    if (stars.length > 0 && ratingInput) {
        stars.forEach(star => {
            // Click to select rating
            star.addEventListener('click', function() {
                const value = this.getAttribute('data-value');
                ratingInput.value = value;
                
                // Update UI based on selected value
                stars.forEach(s => {
                    if (parseInt(s.getAttribute('data-value')) <= parseInt(value)) {
                        s.classList.remove('text-white/20');
                        s.classList.add('text-brand');
                    } else {
                        s.classList.add('text-white/20');
                        s.classList.remove('text-brand');
                    }
                });
            });
            
            // Hover effect
            star.addEventListener('mouseenter', function() {
                const value = this.getAttribute('data-value');
                const currentValue = ratingInput.value || 0;
                
                stars.forEach(s => {
                    if (parseInt(s.getAttribute('data-value')) <= parseInt(value)) {
                        s.style.transform = 'scale(1.2)';
                        if (parseInt(s.getAttribute('data-value')) > currentValue) {
                            s.classList.add('text-brand/50'); // Preview color
                        }
                    }
                });
            });
            
            // Mouse leave effect
            star.addEventListener('mouseleave', function() {
                const currentValue = ratingInput.value || 0;
                stars.forEach(s => {
                    s.style.transform = 'scale(1)';
                    s.classList.remove('text-brand/50');
                    
                    // Restore correct colors based on actual selected value
                    if (parseInt(s.getAttribute('data-value')) <= currentValue) {
                        s.classList.remove('text-white/20');
                        s.classList.add('text-brand');
                    } else {
                        s.classList.add('text-white/20');
                        s.classList.remove('text-brand');
                    }
                });
            });
        });
    }
});