document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer for fade-up animations
    const observerOptions = {
        root: null,
        rootMargin: '0px 0px -50px 0px',
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                // Unobserve after animating once
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Select all elements with the fade-up class
    const fadeElements = document.querySelectorAll('.fade-up-element');
    fadeElements.forEach(el => {
        observer.observe(el);
    });

    // Fly-to-cart Animation Logic
    const addToCartBtns = document.querySelectorAll('.js-add-to-cart-btn');
    
    // Try to find the cart icon in the header. Fallback to top right if not found.
    const getCartTarget = () => {
        const potentialTargets = [
            '#cart-icon', '.cart-icon', '[data-cart-icon]', 
            'header svg[class*="cart"]', 'header svg[class*="bag"]',
            '.header-cart'
        ];
        
        for (let selector of potentialTargets) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        
        // Fallback coordinates (top right corner)
        return { 
            getBoundingClientRect: () => ({ 
                top: 30, left: window.innerWidth - 60, width: 30, height: 30 
            }) 
        };
    };

    addToCartBtns.forEach(btn => {
        btn.addEventListener('click', function(e) {
            // We don't prevent default here to allow any global ajax cart scripts to run,
            // we just add the visual effect on top.
            
            const card = this.closest('.group');
            if (!card) return;
            
            const img = card.querySelector('img');
            if (!img) return;

            const cartTarget = getCartTarget();
            const targetRect = typeof cartTarget.getBoundingClientRect === 'function' ? 
                               cartTarget.getBoundingClientRect() : cartTarget;

            const imgRect = img.getBoundingClientRect();
            
            // Create clone
            const clone = img.cloneNode(true);
            clone.classList.add('flying-image');
            
            // Set initial position and size
            clone.style.top = `${imgRect.top}px`;
            clone.style.left = `${imgRect.left}px`;
            clone.style.width = `${imgRect.width}px`;
            clone.style.height = `${imgRect.height}px`;
            
            document.body.appendChild(clone);

            // Force reflow to ensure transition works
            clone.offsetHeight;

            // Animate to target
            // Center the flying image on the target
            const targetTop = targetRect.top + (targetRect.height / 2) - 25; // 25 is half of end width (50px)
            const targetLeft = targetRect.left + (targetRect.width / 2) - 25;

            clone.style.top = `${targetTop}px`;
            clone.style.left = `${targetLeft}px`;
            clone.style.width = '50px';
            clone.style.height = '50px';
            clone.style.opacity = '0.4';
            clone.style.transform = 'scale(0.5) rotate(15deg)';

            // Clean up and optional target bump
            setTimeout(() => {
                clone.remove();
                
                // Add a little bump animation to the actual target if it's a DOM element
                if (cartTarget.classList) {
                    const originalTransition = cartTarget.style.transition;
                    const originalTransform = cartTarget.style.transform;
                    
                    cartTarget.style.transition = 'transform 0.2s ease';
                    cartTarget.style.transform = 'scale(1.2)';
                    
                    setTimeout(() => {
                        cartTarget.style.transform = originalTransform;
                        cartTarget.style.transition = originalTransition;
                    }, 200);
                }
            }, 800); // Matches the CSS transition duration
        });
    });
});