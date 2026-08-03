document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer for fade-up animations
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Optional: Stop observing once animated
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const fadeElements = document.querySelectorAll('.fade-up');
    fadeElements.forEach((el, index) => {
        // Add staggered delay based on index if they appear at once
        el.style.transitionDelay = `${(index % 5) * 100}ms`;
        observer.observe(el);
    });

    // Add to cart flying animation logic for product cards in search results
    document.addEventListener('click', function(e) {
        // Find closest button that might be an add-to-cart button (adjust selector based on your card component)
        const btn = e.target.closest('button[type="submit"], .add-to-cart, .btn-add-cart');
        if (!btn) return;

        // Find the parent product card
        const card = btn.closest('.group, article, .product-card');
        if (!card) return;

        const img = card.querySelector('img');
        // Try to find the cart icon in the header (common selectors)
        const cartIcon = document.getElementById('cart-icon');

        if (img && cartIcon) {
            const imgRect = img.getBoundingClientRect();
            const cartRect = cartIcon.getBoundingClientRect();

            const flyingImg = img.cloneNode(true);
            flyingImg.classList.add('flying-image');
            flyingImg.style.left = `${imgRect.left}px`;
            flyingImg.style.top = `${imgRect.top}px`;
            flyingImg.style.width = `${imgRect.width}px`;
            flyingImg.style.height = `${imgRect.height}px`;
            flyingImg.style.borderRadius = '24px'; // Match organic style initially

            document.body.appendChild(flyingImg);

            // Trigger animation in next frame
            requestAnimationFrame(() => {
                flyingImg.style.left = `${cartRect.left + (cartRect.width / 2) - 15}px`;
                flyingImg.style.top = `${cartRect.top + (cartRect.height / 2) - 15}px`;
                flyingImg.style.width = '30px';
                flyingImg.style.height = '30px';
                flyingImg.style.borderRadius = '50%';
                flyingImg.style.opacity = '0.4';
                flyingImg.style.transform = 'scale(0.5)';
            });

            // Clean up after animation completes
            setTimeout(() => {
                flyingImg.remove();
            }, 800);
        }
    });
});