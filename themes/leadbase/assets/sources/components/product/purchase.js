document.addEventListener('DOMContentLoaded', () => {
  const variantsDataEl = document.getElementById('variants-data');
  const variantPicker = document.getElementById('variant-picker');
  const customContainer = document.getElementById('custom-variant-container');
  
  // Custom visual variant pills builder
  if (variantsDataEl && variantPicker && customContainer) {
    try {
      const variantsText = variantsDataEl.textContent.trim();
      if (variantsText) {
        const variants = JSON.parse(variantsText);
        
        variants.forEach(variant => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'variant-pill px-6 py-3 border rounded-full text-sm font-medium transition-all duration-300 relative overflow-hidden';
          btn.textContent = variant.title;
          btn.dataset.value = variant.id;
          
          if (variantPicker.value === variant.id.toString()) {
            btn.classList.add('border-emerald-500', 'text-emerald-700', 'bg-emerald-50', 'ring-1', 'ring-emerald-500');
            btn.classList.remove('border-gray-200', 'text-gray-600', 'bg-white', 'hover:border-emerald-300');
          } else {
            btn.classList.add('border-gray-200', 'text-gray-600', 'bg-white', 'hover:border-emerald-300');
          }
          
          btn.addEventListener('click', () => {
            variantPicker.value = variant.id;
            variantPicker.dispatchEvent(new Event('change', { bubbles: true }));
            
            document.querySelectorAll('.variant-pill').forEach(p => {
              p.classList.remove('border-emerald-500', 'text-emerald-700', 'bg-emerald-50', 'ring-1', 'ring-emerald-500');
              p.classList.add('border-gray-200', 'text-gray-600', 'bg-white', 'hover:border-emerald-300');
            });
            btn.classList.add('border-emerald-500', 'text-emerald-700', 'bg-emerald-50', 'ring-1', 'ring-emerald-500');
            btn.classList.remove('border-gray-200', 'text-gray-600', 'bg-white', 'hover:border-emerald-300');
          });
          
          customContainer.appendChild(btn);
        });
        
        variantPicker.addEventListener('change', (e) => {
          const val = e.target.value;
          document.querySelectorAll('.variant-pill').forEach(p => {
            if (p.dataset.value === val) {
              p.classList.add('border-emerald-500', 'text-emerald-700', 'bg-emerald-50', 'ring-1', 'ring-emerald-500');
              p.classList.remove('border-gray-200', 'text-gray-600', 'bg-white', 'hover:border-emerald-300');
            } else {
              p.classList.remove('border-emerald-500', 'text-emerald-700', 'bg-emerald-50', 'ring-1', 'ring-emerald-500');
              p.classList.add('border-gray-200', 'text-gray-600', 'bg-white', 'hover:border-emerald-300');
            }
          });
        });
      }
    } catch (e) {
      console.error('Error parsing variants data', e);
    }
  }

  // Buy Now Modal Logic
  const buyNowTrigger = document.getElementById('buy-now-trigger');
  const buyNowModal = document.getElementById('buy-now-modal');
  const buyNowCancel = document.getElementById('buy-now-cancel');
  const buyNowClose = document.getElementById('buy-now-close');
  const buyNowOverlay = document.getElementById('buy-now-overlay');
  
  if (buyNowTrigger && buyNowModal) {
    buyNowTrigger.addEventListener('click', () => {
      buyNowModal.classList.remove('hidden');
    });
    
    const closeModal = () => {
      buyNowModal.classList.add('hidden');
      const errorDiv = document.getElementById('buy-now-error');
      if(errorDiv) {
        errorDiv.classList.add('hidden');
        errorDiv.textContent = '';
      }
    };
    
    if (buyNowCancel) buyNowCancel.addEventListener('click', closeModal);
    if (buyNowClose) buyNowClose.addEventListener('click', closeModal);
    if (buyNowOverlay) buyNowOverlay.addEventListener('click', closeModal);
  }

  // Flying to cart animation
  const addToCartBtn = document.getElementById('add-to-cart');
  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', function(e) {
      // Don't animate if button is disabled/loading
      if (this.disabled || this.classList.contains('loading')) return;
      
      const cartIcon = document.querySelector('[href="/cart"]') || document.querySelector('#cart-drawer-trigger');
      if (!cartIcon) return;
      
      const rect = this.getBoundingClientRect();
      const targetRect = cartIcon.getBoundingClientRect();
      
      const flyingDot = document.createElement('div');
      flyingDot.className = 'fixed z-[9999] w-6 h-6 bg-emerald-500 rounded-full shadow-lg pointer-events-none';
      // Start from click position or center of button
      const startX = e.clientX || (rect.left + rect.width / 2);
      const startY = e.clientY || (rect.top + rect.height / 2);
      
      flyingDot.style.left = `${startX - 12}px`;
      flyingDot.style.top = `${startY - 12}px`;
      flyingDot.style.transition = 'all 0.8s cubic-bezier(0.2, 1, 0.3, 1)';
      document.body.appendChild(flyingDot);
      
      // Trigger reflow
      flyingDot.getBoundingClientRect();
      
      flyingDot.style.left = `${targetRect.left + targetRect.width/2 - 12}px`;
      flyingDot.style.top = `${targetRect.top + targetRect.height/2 - 12}px`;
      flyingDot.style.transform = 'scale(0.2)';
      flyingDot.style.opacity = '0.5';
      
      setTimeout(() => {
        flyingDot.remove();
        cartIcon.style.transition = 'transform 0.2s ease';
        cartIcon.style.transform = 'scale(1.2)';
        setTimeout(() => {
          cartIcon.style.transform = 'scale(1)';
        }, 200);
      }, 800);
    });
  }
});