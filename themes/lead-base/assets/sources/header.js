// JS tùy chỉnh cho theme này
// KHÔNG được định nghĩa lại các id đã dùng bởi JS gắn sẵn trong product-detail.liquid/cart.liquid/
// blog-post-locked.liquid (add-to-cart, cart-items, checkout-form, unlock-form...).

(function () {
  // =============================================
  // MOBILE DRAWER
  // =============================================
  var btn      = document.getElementById('mobile-menu-btn');
  var closeBtn = document.getElementById('mobile-drawer-close');
  var overlay  = document.getElementById('mobile-drawer-overlay');
  var drawer   = document.getElementById('mobile-drawer');

  function openDrawer() {
    if (!drawer || !overlay) return;
    drawer.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (!drawer || !overlay) return;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (btn)      btn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (overlay)  overlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeDrawer();
      if (typeof closeCartDrawer === 'function') closeCartDrawer();
    }
  });

  // =============================================
  // CART DRAWER
  // =============================================
  var cartBtn = document.getElementById('header-cart-btn');
  var cartCloseBtn = document.getElementById('cart-drawer-close');
  var cartOverlay = document.getElementById('cart-drawer-overlay');
  var cartDrawer = document.getElementById('cart-drawer');
  var cartItemsContainer = document.getElementById('cart-drawer-items');
  var cartEmpty = document.getElementById('cart-drawer-empty');
  var cartTotal = document.getElementById('cart-drawer-total');

  function formatMoney(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + 'đ';
  }

  function renderCartDrawer() {
    if (!cartItemsContainer || !cartEmpty || !cartTotal) return;
    try {
      var cartData = JSON.parse(localStorage.getItem('cart') || '[]');
      if (!Array.isArray(cartData) || cartData.length === 0) {
        cartItemsContainer.innerHTML = '';
        cartItemsContainer.classList.add('hidden');
        cartEmpty.classList.remove('hidden');
        cartEmpty.classList.add('flex');
        cartTotal.textContent = '0đ';
        return;
      }

      cartEmpty.classList.add('hidden');
      cartEmpty.classList.remove('flex');
      cartItemsContainer.classList.remove('hidden');

      var html = '';
      var total = 0;
      cartData.forEach(function(item) {
        var price = parseInt(item.price, 10) || 0;
        var qty = parseInt(item.quantity, 10) || 1;
        total += price * qty;
        
        var img = item.image || '';
        var title = item.title || 'Sản phẩm';
        var variant = item.variantTitle ? '<div class="text-xs text-gray-500 mt-1">' + item.variantTitle + '</div>' : '';
        
        html += '<div class="flex gap-3 py-3 border-b border-gray-50 last:border-0">';
        if (img) {
          html += '  <img src="' + img + '" alt="' + title.replace(/"/g, '&quot;') + '" class="w-16 h-16 object-cover rounded-md border border-gray-100 flex-shrink-0">';
        } else {
          html += '  <div class="w-16 h-16 bg-gray-100 rounded-md border border-gray-200 flex-shrink-0 flex items-center justify-center text-gray-400 text-xs">No img</div>';
        }
        html += '  <div class="flex-1 min-w-0 flex flex-col justify-center">';
        html += '    <h3 class="text-sm font-medium text-gray-900 truncate" title="' + title.replace(/"/g, '&quot;') + '">' + title + '</h3>';
        html += variant;
        html += '    <div class="flex items-center justify-between mt-1.5">';
        html += '      <span class="text-sm font-semibold text-blue-600">' + formatMoney(price) + '</span>';
        html += '      <span class="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">SL: ' + qty + '</span>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
      });
      
      cartItemsContainer.innerHTML = html;
      cartTotal.textContent = formatMoney(total);
    } catch (e) {
      console.error('Error rendering cart drawer:', e);
    }
  }

  function openCartDrawer() {
    if (!cartDrawer || !cartOverlay) return;
    renderCartDrawer();
    cartDrawer.classList.add('open');
    cartOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeCartDrawer() {
    if (!cartDrawer || !cartOverlay) return;
    cartDrawer.classList.remove('open');
    cartOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (cartBtn) {
    cartBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openCartDrawer();
    });
  }
  if (cartCloseBtn) cartCloseBtn.addEventListener('click', closeCartDrawer);
  if (cartOverlay)  cartOverlay.addEventListener('click', closeCartDrawer);

  // =============================================
  // CART BADGE — đọc số lượng từ localStorage
  // =============================================
  function updateCartBadge() {
    var badge = document.getElementById('header-cart-badge');
    if (!badge) return;

    var count = 0;

    // Thử đọc key "cartCount" (số nguyên trực tiếp)
    var raw = localStorage.getItem('cartCount');
    if (raw !== null) {
      count = parseInt(raw, 10) || 0;
    } else {
      // Thử đọc key "cart" (mảng JSON các item với trường quantity)
      try {
        var cartData = JSON.parse(localStorage.getItem('cart') || '[]');
        if (Array.isArray(cartData)) {
          count = cartData.reduce(function (sum, item) {
            return sum + (parseInt(item.quantity, 10) || 1);
          }, 0);
        }
      } catch (e) { /* bỏ qua lỗi parse */ }
    }

    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.add('visible');
    } else {
      badge.textContent = '';
      badge.classList.remove('visible');
    }
  }

  updateCartBadge();

  // Lắng nghe thay đổi localStorage từ tab khác
  window.addEventListener('storage', function (e) {
    if (e.key === 'cartCount' || e.key === 'cart') {
      updateCartBadge();
      if (cartDrawer && cartDrawer.classList.contains('open')) {
        renderCartDrawer();
      }
    }
  });

  // Lắng nghe custom event "cartUpdated" từ cart.liquid / product-detail.liquid
  window.addEventListener('cartUpdated', function() {
    updateCartBadge();
    if (cartDrawer && cartDrawer.classList.contains('open')) {
      renderCartDrawer();
    }
  });
})();