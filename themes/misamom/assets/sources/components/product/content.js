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