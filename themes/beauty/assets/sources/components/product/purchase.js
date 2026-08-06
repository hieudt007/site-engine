document.addEventListener('DOMContentLoaded', () => {
  // UI chon bien the (pills nhom theo tung thuoc tinh: Mau/Size...) da duoc dung
  // assets/sources/product-detail.js dung ma tren #custom-variant-container - KHONG duoc dung o
  // day nua (ban cu o day dung "variant.title" khong ton tai trong du lieu, tao nut trong de len
  // tren UI dung, da xoa het phan do).

  // Nut "Mua ngay" (#buy-now-trigger) chuyen thang sang /checkout - logic nam trong
  // product-detail.js (initBuyNow), khong con modal o day nua.

  // Flying to cart animation
  const addToCartBtn = document.getElementById('add-to-cart');
  if (addToCartBtn) {
    addToCartBtn.addEventListener('click', function(e) {
      // Don't animate if button is disabled/loading
      if (this.disabled || this.classList.contains('loading')) return;
      
      const cartIcon = document.getElementById('cart-icon');
      if (!cartIcon) return;
      
      const rect = this.getBoundingClientRect();
      const targetRect = cartIcon.getBoundingClientRect();
      
      const flyingDot = document.createElement('div');
      flyingDot.className = 'fixed z-[9999] w-6 h-6 bg-blue-500 rounded-full shadow-lg pointer-events-none';
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