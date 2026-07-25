document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer for scroll animations (fade up elements)
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Optional: stop observing once animated
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Select elements to animate
    const animatedElements = document.querySelectorAll('.scroll-animate, .text-center h2');
    
    animatedElements.forEach(el => {
        // Add base class if not already present
        if(!el.classList.contains('scroll-animate')) {
            el.classList.add('scroll-animate');
        }
        observer.observe(el);
    });

    // Add to Cart Animation
    initAddToCartAnimation();
});

function initAddToCartAnimation() {
    const cartButtons = document.querySelectorAll('.add-to-cart-quick');
    // Find the cart icon in header (fallback to any svg if specific link not found)
    const cartIcon = document.querySelector('header a[href="/cart"]') || 
                     document.querySelector('header button[aria-controls*="cart"]') || 
                     document.querySelector('header svg');

    cartButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            
            const productCard = this.closest('.product-card');
            const productImg = productCard ? productCard.querySelector('img') : null;
            
            if (!cartIcon || !productImg) return;

            // Create clone for animation
            const clone = productImg.cloneNode(true);
            const rect = productImg.getBoundingClientRect();
            const cartRect = cartIcon.getBoundingClientRect();

            // Set initial styles for clone
            Object.assign(clone.style, {
                position: 'fixed',
                top: `${rect.top}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                objectFit: 'cover',
                borderRadius: '1.5rem',
                zIndex: '9999',
                transition: 'all 0.8s cubic-bezier(0.25, 1, 0.5, 1)',
                pointerEvents: 'none',
                boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
            });

            document.body.appendChild(clone);

            // Trigger animation in next frame
            requestAnimationFrame(() => {
                Object.assign(clone.style, {
                    top: `${cartRect.top + cartRect.height/2 - 15}px`,
                    left: `${cartRect.left + cartRect.width/2 - 15}px`,
                    width: '30px',
                    height: '30px',
                    opacity: '0.4',
                    borderRadius: '50%'
                });
            });

            // Cleanup and bump cart icon
            setTimeout(() => {
                clone.remove();
                
                // Bump effect
                cartIcon.style.transition = 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                cartIcon.style.transform = 'scale(1.3)';
                cartIcon.style.color = '#10B981'; // emerald-500
                
                setTimeout(() => {
                    cartIcon.style.transform = 'scale(1)';
                    cartIcon.style.color = '';
                }, 200);
            }, 800);
        });
    });
}