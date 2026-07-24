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
      setTimeout(() => panel.classList.remove("translate-x-full"), 10);
      render();
    } else {
      panel.classList.add("translate-x-full");
      setTimeout(() => drawer.classList.add("hidden"), 300);
    }
  }

  closeBtn?.addEventListener("click", () => toggleDrawer(false));
  backdrop?.addEventListener("click", () => toggleDrawer(false));

  document.addEventListener("click", (e) => {
    const icon = e.target.closest("#cart-icon");
    if (icon) {
      e.preventDefault();
      toggleDrawer(true);
    }
  });

  async function render() {
    const cart = readCart();
    if (cart.length === 0) {
      itemsContainer.innerHTML = '<p class="text-gray-500 text-center mt-10">Giỏ hàng trống.</p>';
      totalContainer.textContent = "";
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
      let unitPrice, label;
      if (item.variantId) {
        const v = (p.variants || []).find((x) => x.id === item.variantId);
        if (!v) return "";
        unitPrice = v.salePrice ? Number(v.salePrice) : Number(v.price);
        label = p.name + (v.attributes ? ` (${Object.values(v.attributes).join(", ")})` : "");
      } else {
        unitPrice = p.salePrice ? Number(p.salePrice) : Number(p.price);
        label = p.name;
      }
      total += unitPrice * item.quantity;
      return `
        <div class="flex justify-between items-center py-2 border-b">
          <div>
            <div class="font-medium">${label}</div>
            <div class="text-sm text-gray-500">${unitPrice}₫ × ${item.quantity}</div>
          </div>
          <div class="flex items-center gap-3">
            <div class="font-bold">${unitPrice * item.quantity}₫</div>
            <button data-index="${index}" class="cart-remove text-red-500 text-sm">Xoá</button>
          </div>
        </div>
      `;
    });

    itemsContainer.innerHTML = rows.join("");
    totalContainer.textContent = "Tổng cộng: " + total + "₫";

    itemsContainer.querySelectorAll(".cart-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        const newCart = readCart().filter((_, i) => i !== idx);
        writeCart(newCart);
      });
    });
  }
})();
