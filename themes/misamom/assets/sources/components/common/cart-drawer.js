// Cart Drawer Logic
(function () {
  const CART_KEY = "site_engine_cart";
  const drawer = document.getElementById("cart-drawer");
  const panel = document.getElementById("cart-drawer-panel");
  const itemsContainer = document.getElementById("cart-drawer-items");
  const totalContainer = document.getElementById("cart-drawer-total");
  const closeBtn = document.getElementById("cart-drawer-close");
  const backdrop = document.getElementById("cart-drawer-backdrop");
  
  if (!drawer || !itemsContainer) return;

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    render();
  }

  function toggleDrawer(show) {
    if (show) {
      drawer.classList.remove("hidden");
      // Force reflow for transitions
      void drawer.offsetWidth;
      panel.classList.remove("translate-x-full");
      backdrop?.classList.remove("opacity-0");
      render();
    } else {
      panel.classList.add("translate-x-full");
      backdrop?.classList.add("opacity-0");
      setTimeout(() => drawer.classList.add("hidden"), 500);
    }
  }

  closeBtn?.addEventListener("click", () => toggleDrawer(false));
  backdrop?.addEventListener("click", () => toggleDrawer(false));

  document.addEventListener("click", (e) => {
    const icon = e.target.closest('a[href="/cart"], #cart-icon');
    if (icon) {
      e.preventDefault();
      toggleDrawer(true);
      return;
    }

    // Global Add to Cart
    const addBtn = e.target.closest(".global-add-to-cart-btn");
    if (addBtn) {
      e.preventDefault();
      const productId = addBtn.dataset.productId;
      if (!productId) return;

      const variantId = addBtn.dataset.variantId || undefined;
      const quantity = parseInt(addBtn.dataset.quantity || "1", 10);

      const cart = readCart();
      const existing = cart.find((c) => c.productId === productId && c.variantId === variantId);
      if (existing) {
        existing.quantity += quantity;
      } else {
        cart.push({ productId, quantity, variantId });
      }
      writeCart(cart);
      
      const msg = addBtn.querySelector(".add-to-cart-msg");
      if (msg) {
        msg.textContent = "Đã thêm";
        setTimeout(() => (msg.textContent = ""), 2000);
      }
      
      toggleDrawer(true);
    }
  });

  const formatPrice = (price) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  async function render() {
    const cart = readCart();
    if (cart.length === 0) {
      itemsContainer.innerHTML = `
        <div class="text-center py-12 flex flex-col items-center justify-center h-full">
          <div class="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mb-6 shadow-inner border border-emerald-100">
            <svg class="mx-auto h-10 w-10 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </div>
          <p class="text-emerald-900/80 font-medium text-lg">Giỏ hàng đang trống</p>
          <p class="text-emerald-900/50 mt-2 text-sm">Hãy khám phá thêm các sản phẩm thiên nhiên nhé!</p>
        </div>
      `;
      totalContainer.textContent = formatPrice(0);
      return;
    }

    const ids = cart.map((c) => c.productId).join(",");
    const res = await fetch("/api/cart/products?ids=" + encodeURIComponent(ids));
    const { products } = await res.json();
    const byId = Object.fromEntries(products.map((p) => [p.id, p]));

    let total = 0;
    const rows = cart.map((item, index) => {
      const p = byId[item.productId];
      if (!p) return "";
      
      let unitPrice, label, variantLabel = "";
      if (item.variantId) {
        const v = (p.variants || []).find((x) => x.id === item.variantId);
        if (!v) return "";
        unitPrice = v.salePrice ? Number(v.salePrice) : Number(v.price);
        label = p.name;
        variantLabel = v.attributes ? Object.values(v.attributes).join(" / ") : "";
      } else {
        unitPrice = p.salePrice ? Number(p.salePrice) : Number(p.price);
        label = p.name;
      }
      total += unitPrice * item.quantity;
      
      const imageUrl = p.thumbnail || (p.images && p.images[0]) || 'https://placehold.co/100x100/E8ECF0/64748B?text=No+Image';

      return `
        <li class="flex py-6 relative z-10 group/item">
          <div class="h-24 w-24 flex-shrink-0 overflow-hidden rounded-[20px] border border-emerald-900/5 bg-white shadow-sm relative group-hover/item:shadow-md transition-shadow">
            <img src="${imageUrl}" alt="${label}" class="h-full w-full object-cover object-center transition-transform duration-700 group-hover/item:scale-110">
          </div>

          <div class="ml-4 flex flex-1 flex-col">
            <div>
              <div class="flex justify-between text-base font-medium text-emerald-950">
                <h3 class="font-heading line-clamp-2 pr-4"><a href="/product/${p.slug || p.id}" class="hover:text-emerald-600 transition-colors">${label}</a></h3>
                <p class="ml-4 whitespace-nowrap text-emerald-700 font-medium">${formatPrice(unitPrice)}</p>
              </div>
              ${variantLabel ? `<p class="mt-1 text-sm text-emerald-900/60">${variantLabel}</p>` : ''}
            </div>
            <div class="flex flex-1 items-end justify-between text-sm mt-3">
              <div class="flex items-center border border-emerald-900/10 rounded-full bg-white shadow-sm overflow-hidden h-8">
                <button type="button" class="cart-qty-btn px-3 h-full text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center justify-center" data-index="${index}" data-action="minus">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path></svg>
                </button>
                <span class="px-2 min-w-[2rem] text-center text-emerald-950 font-medium">${item.quantity}</span>
                <button type="button" class="cart-qty-btn px-3 h-full text-emerald-700 hover:bg-emerald-50 transition-colors flex items-center justify-center" data-index="${index}" data-action="plus">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                </button>
              </div>

              <div class="flex">
                <button type="button" data-index="${index}" class="cart-remove p-2 -mr-2 text-emerald-900/40 hover:text-red-500 hover:bg-red-50 rounded-full transition-all" title="Xoá">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
              </div>
            </div>
          </div>
        </li>
      `;
    });

    itemsContainer.innerHTML = `<ul role="list" class="-my-6 divide-y divide-emerald-900/5">${rows.join("")}</ul>`;
    totalContainer.textContent = formatPrice(total);

    itemsContainer.querySelectorAll(".cart-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        const newCart = readCart().filter((_, i) => i !== idx);
        writeCart(newCart);
      });
    });

    itemsContainer.querySelectorAll(".cart-qty-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        const action = btn.dataset.action;
        let cart = readCart();
        if(action === 'plus') {
          cart[idx].quantity += 1;
        } else if(action === 'minus') {
          cart[idx].quantity -= 1;
          if(cart[idx].quantity <= 0) {
            cart = cart.filter((_, i) => i !== idx);
          }
        }
        writeCart(cart);
      });
    });
  }
})();