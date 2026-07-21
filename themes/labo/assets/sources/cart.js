// JS riêng cho cart.liquid — Tách từ file liquid cũ, giữ nguyên logic cốt lõi và bổ sung class Tailwind cho HTML sinh ra.
(function () {
  const CART_KEY = "site_engine_cart";

  function collectExtraFields(form, knownNames) {
    const result = {};
    [...form.elements].forEach((el) => {
      if (!el.name || knownNames.includes(el.name) || el.type === "submit" || el.type === "button") return;
      if (el.value) result[el.name] = el.value;
    });
    return result;
  }

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount);
  }

  async function render() {
    const cart = readCart();
    const container = document.getElementById("cart-items");
    const form = document.getElementById("checkout-form");

    if (!container) return;

    if (cart.length === 0) {
      container.innerHTML = '<div class="text-center py-16 px-4"><div class="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4"><svg class="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg></div><p class="text-slate-500 mb-6">Giỏ hàng của bạn đang trống.</p><a href="/products" class="inline-flex items-center justify-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors">Tiếp tục mua sắm</a></div>';
      if(form) form.classList.add("hidden");
      return;
    }

    const ids = cart.map((c) => c.productId).join(",");
    try {
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
            const attrs = v.attributes || {};
            const attrText = Object.entries(attrs).map(([k, val]) => k + ": " + val).join(", ");
            label = escapeHtml(p.name) + (attrText ? " <span class='block text-sm text-slate-500 font-normal mt-1'>" + escapeHtml(attrText) + "</span>" : "");
          } else {
            unitPrice = p.salePrice ? Number(p.salePrice) : Number(p.price);
            label = escapeHtml(p.name);
          }

          total += unitPrice * item.quantity;
          return (
            '<div class="flex flex-col sm:flex-row sm:items-center justify-between p-5 border-b border-slate-100 last:border-b-0 gap-4 hover:bg-slate-50/50 transition-colors">' +
              '<div class="flex-1">' +
                '<div class="font-medium text-slate-900">' + label + '</div>' +
                '<div class="text-sm text-slate-500 mt-1.5">' + formatMoney(unitPrice) + '₫ <span class="mx-1 text-slate-300">×</span> ' + item.quantity + '</div>' +
              '</div>' +
              '<div class="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto">' +
                '<div class="font-semibold text-slate-900">' + formatMoney(unitPrice * item.quantity) + '₫</div>' +
                '<button type="button" data-index="' + index + '" class="cart-remove text-sm text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-md font-medium transition-colors" title="Xoá sản phẩm">' +
                  '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>' +
                '</button>' +
              '</div>' +
            '</div>'
          );
        });

        container.innerHTML = rows.join("");
        const totalEl = document.getElementById("cart-total");
        if(totalEl) {
            totalEl.innerHTML = '<span class="text-slate-600 font-medium">Tổng thanh toán:</span> <span class="text-2xl font-bold text-blue-600">' + formatMoney(total) + '₫</span>';
        }
        if(form) form.classList.toggle("hidden", cart.length === 0);

        container.querySelectorAll(".cart-remove").forEach((btn) => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.index);
            writeCart(readCart().filter((_, i) => i !== idx));
            render();
          });
        });
    } catch(e) {
        container.innerHTML = '<div class="p-6 text-center text-red-500">Đã xảy ra lỗi khi tải giỏ hàng. Vui lòng tải lại trang.</div>';
    }
  }

  const checkoutForm = document.getElementById("checkout-form");
  if(checkoutForm) {
      checkoutForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.target;
        const errorEl = document.getElementById("checkout-error");
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        
        errorEl.textContent = "";
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang xử lý...";

        const cart = readCart();
        try {
            const res = await fetch("/cart/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                items: cart.map((c) => ({ productId: c.productId, variantId: c.variantId, quantity: c.quantity })),
                customerName: form.customerName.value,
                customerPhone: form.customerPhone.value,
                customerAddress: form.customerAddress.value || undefined,
                customFields: collectExtraFields(form, ["customerName", "customerPhone", "customerAddress"]),
              }),
            });

            if (!res.ok) {
              errorEl.textContent = "Đặt hàng thất bại, vui lòng kiểm tra lại thông tin.";
              submitBtn.disabled = false;
              submitBtn.textContent = originalText;
              return;
            }

            const { orderId } = await res.json();
            writeCart([]);
            window.location.href = "/order-confirmation/" + orderId;
        } catch(e) {
            errorEl.textContent = "Lỗi kết nối mạng. Vui lòng thử lại.";
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();