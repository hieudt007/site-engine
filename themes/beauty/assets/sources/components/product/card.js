document.addEventListener('DOMContentLoaded', () => {
  // Intersection Observer for fade-up animation on scroll
  const productCards = document.querySelectorAll('.product-card');
  
  if (productCards.length > 0 && 'IntersectionObserver' in window) {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const cardObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('opacity-100', 'translate-y-0');
          entry.target.classList.remove('opacity-0', 'translate-y-8');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    productCards.forEach((card, index) => {
      if (!card.classList.contains('opacity-100')) {
        card.classList.add('opacity-0', 'translate-y-8', 'transition-all', 'duration-700', 'ease-out');
        card.style.transitionDelay = `${(index % 4) * 100}ms`;
        cardObserver.observe(card);
      }
    });
  }

  // Handle Add to Cart button loading state & Flying Animation
  document.querySelectorAll('.global-add-to-cart-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const btnElement = this;
      const textSpan = btnElement.querySelector('.add-text');
      const originalHtml = btnElement.innerHTML;
      
      if (btnElement.classList.contains('is-loading')) return;
      btnElement.classList.add('is-loading');
      btnElement.style.pointerEvents = 'none';
      
      // Set loading state
      btnElement.innerHTML = `
        <svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>Đang thêm...</span>
      `;

      // --- Flying Animation Logic ---
      const card = btnElement.closest('.product-card');
      const img = card ? card.querySelector('.product-image-target') : null;
      // Try to find cart icon in header (common selectors)
      const cartIcon = document.getElementById('cart-icon');

      if (img && cartIcon) {
        const imgRect = img.getBoundingClientRect();
        const cartRect = cartIcon.getBoundingClientRect();

        // Create clone
        const clone = img.cloneNode(true);
        clone.classList.add('flying-product-img');
        
        // Initial position (center of original image)
        clone.style.top = `${imgRect.top}px`;
        clone.style.left = `${imgRect.left}px`;
        clone.style.width = `${imgRect.width}px`;
        clone.style.height = `${imgRect.height}px`;
        
        document.body.appendChild(clone);

        // Force reflow
        clone.getBoundingClientRect();

        // Animate to cart icon
        requestAnimationFrame(() => {
          clone.style.top = `${cartRect.top + (cartRect.height / 2) - 20}px`;
          clone.style.left = `${cartRect.left + (cartRect.width / 2) - 20}px`;
          clone.style.width = '40px';
          clone.style.height = '40px';
          clone.style.opacity = '0.5';
          clone.style.transform = 'scale(0.5)';
        });

        // Cleanup and trigger cart icon pop
        setTimeout(() => {
          clone.remove();
          cartIcon.classList.add('cart-icon-pop');
          setTimeout(() => {
            cartIcon.classList.remove('cart-icon-pop');
          }, 400);
        }, 800);
      }
      // --- End Flying Animation ---
      
      // Reset button after 1.5s
      setTimeout(() => {
        btnElement.innerHTML = originalHtml;
        btnElement.classList.remove('is-loading');
        btnElement.style.pointerEvents = 'auto';
      }, 1500);
    });
  });
});