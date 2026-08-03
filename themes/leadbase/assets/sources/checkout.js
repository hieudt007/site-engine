(function () {
  const checkoutForm = document.getElementById("checkout-form");
  const checkoutItems = document.getElementById("checkout-items");
  if (!checkoutForm || !checkoutItems) return;

  const CART_KEY = "site_engine_cart";

  // Luong "Mua ngay" tu trang san pham chuyen sang day voi query param buyNowProductId/
  // buyNowVariantId (xem product-detail.js initBuyNow) - khi co, trang nay CHI hien thi/dat hang
  // dung 1 san pham nay (quantity luon 1), KHONG doc/ghi gio hang that qua readCart/writeCart o
  // duoi (de tranh gop nham voi cac san pham khac dang co san). Truoc do initBuyNow da tu them
  // san pham nay vao gio hang that roi (de neu khach roi trang ma khong dat hang thi van con trong
  // gio) - khi dat hang THANH CONG o che do nay, tru dung 1 don vi khoi gio hang that (xem
  // removeOneFromRealCart), khong dung writeCart([]) vi se xoa nham cac san pham khac/so luong con
  // lai cua chinh san pham nay.
  const buyNowParams = new URLSearchParams(window.location.search);
  const buyNowProductId = buyNowParams.get("buyNowProductId");
  const buyNowItem = buyNowProductId
    ? { productId: buyNowProductId, variantId: buyNowParams.get("buyNowVariantId") || undefined, quantity: 1 }
    : null;
  if (buyNowItem) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + '₫';
  }

  function collectExtraFields(form, knownNames) {
    const result = {};
    [...form.elements].forEach((el) => {
      if (!el.name || knownNames.includes(el.name) || el.type === "submit" || el.type === "button") return;
      if (el.value) result[el.name] = el.value;
    });
    return result;
  }

  function readCart() {
    if (buyNowItem) return [buyNowItem];
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    if (buyNowItem) return;
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }

  function removeOneFromRealCart(item) {
    let realCart;
    try {
      realCart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    } catch {
      realCart = [];
    }
    const existing = realCart.find((c) => c.productId === item.productId && c.variantId === item.variantId);
    if (!existing) return;
    if (existing.quantity > 1) {
      existing.quantity -= 1;
    } else {
      realCart = realCart.filter((c) => c !== existing);
    }
    localStorage.setItem(CART_KEY, JSON.stringify(realCart));
  }

  // Ma da ap dung thanh cong (preview qua /api/cart/apply-coupon, CHUA tang usedCount that su -
  // xem docblock route). Bi xoa moi khi gio hang doi (xoa/sua so luong) de tranh hien so giam gia
  // cu, sai so voi tong moi.
  let appliedCoupon = null;
  let currentSubtotal = 0;

  function updateDiscountUI() {
    const row = document.getElementById("discount-row");
    const display = document.getElementById("discount-display");
    if (!row || !display) return;
    if (appliedCoupon) {
      row.classList.remove("hidden");
      row.classList.add("flex");
      display.textContent = "-" + formatMoney(appliedCoupon.discountAmount);
    } else {
      row.classList.add("hidden");
      row.classList.remove("flex");
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  const PAYMENT_METHOD_LABELS = {
    cod: "Thanh toán khi nhận hàng (COD)",
    bank_transfer: "Chuyển khoản ngân hàng",
    vnpay: "Thanh toán online qua VNPay",
  };

  async function loadProvinces() {
    const select = document.querySelector('select[name="customerProvince"]');
    if (!select) return;
    try {
      const res = await fetch("/api/provinces");
      const { provinces } = await res.json();
      provinces.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
      });
    } catch (e) {
      console.error("Failed to load provinces", e);
    }
  }

  const FULFILLMENT_METHOD_LABELS = {
    delivery: "Giao tận nơi",
    pickup: "Nhận tại cửa hàng",
  };

  function toggleFulfillmentFields(method) {
    const deliveryFields = document.getElementById("delivery-fields");
    const pickupFields = document.getElementById("pickup-fields");
    
    if (method === "delivery") {
      deliveryFields.classList.remove("hidden");
      pickupFields.classList.add("hidden");
      checkoutForm.customerProvince.required = true;
      if(checkoutForm.storeId) checkoutForm.storeId.required = false;
    } else {
      deliveryFields.classList.add("hidden");
      pickupFields.classList.remove("hidden");
      checkoutForm.customerProvince.required = false;
      if(checkoutForm.storeId) checkoutForm.storeId.required = true;
    }
  }

  async function loadFulfillmentMethods() {
    const list = document.getElementById("fulfillment-methods-list");
    try {
      const res = await fetch("/api/cart/fulfillment-methods");
      const { methods, stores } = await res.json();

      const storeSelect = document.querySelector('select[name="storeId"]');
      if (storeSelect && stores) {
        stores.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = s.name + (s.province ? " (" + s.province + ")" : "");
          storeSelect.appendChild(opt);
        });
      }

      if (!methods || methods.length === 0) {
        list.innerHTML = "<p class='text-sm text-slate-900/60'>Chưa có hình thức nhận hàng nào được bật.</p>";
        return;
      }

      list.innerHTML = methods
        .map(
          (m, i) => `
            <label class="custom-radio-label flex items-center p-4 border border-blue-100 bg-blue-50/20 hover:bg-blue-50/80 rounded-[24px] transition-all cursor-pointer group mb-3 last:mb-0">
              <input type="radio" name="fulfillmentMethod" value="${m}" ${i === 0 ? "checked" : ""}>
              <span class="font-medium text-slate-900 text-sm group-hover:text-blue-700 transition-colors">${FULFILLMENT_METHOD_LABELS[m] || m}</span>
            </label>
          `
        )
        .join("");

      list.querySelectorAll('input[name="fulfillmentMethod"]').forEach((radio) => {
        radio.addEventListener("change", () => toggleFulfillmentFields(radio.value));
      });
      toggleFulfillmentFields(methods[0]);
    } catch (e) {
      list.innerHTML = "<p class='text-sm text-red-500'>Không thể tải phương thức nhận hàng.</p>";
    }
  }

  async function loadPaymentMethods() {
    const list = document.getElementById("payment-methods-list");
    try {
      const res = await fetch("/api/cart/payment-methods");
      const { methods } = await res.json();
      if (!methods || methods.length === 0) {
        list.innerHTML = "<p class='text-sm text-slate-900/60'>Chưa có phương thức thanh toán nào được bật.</p>";
        return;
      }
      list.innerHTML = methods
        .map(
          (m, i) => `
            <label class="custom-radio-label flex items-center p-4 border border-blue-100 bg-blue-50/20 hover:bg-blue-50/80 rounded-[24px] transition-all cursor-pointer group mb-3 last:mb-0">
              <input type="radio" name="paymentMethod" value="${m.method}" ${i === 0 ? "checked" : ""}>
              <span class="font-medium text-slate-900 text-sm group-hover:text-blue-700 transition-colors">${PAYMENT_METHOD_LABELS[m.method] || m.method}</span>
            </label>
          `
        )
        .join("");
    } catch (e) {
      list.innerHTML = "<p class='text-sm text-red-500'>Không thể tải phương thức thanh toán.</p>";
    }
  }

  async function render() {
    const cart = readCart();

    if (cart.length === 0) {
      checkoutItems.innerHTML = `
        <div class="text-center py-10 bg-blue-50/50 rounded-[24px] border border-blue-100">
            <p class="text-slate-900/60 mb-4">Giỏ hàng của bạn đang trống.</p>
            <a href="/products" class="inline-block bg-white border border-blue-200 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 rounded-[24px] px-6 py-2.5 transition-all text-sm font-medium">Tiếp tục mua sắm</a>
        </div>
      `;
      checkoutForm.classList.add("hidden");
      document.getElementById("checkout-total").textContent = "0₫";
      const subtotalEl = document.getElementById("subtotal-display");
      if(subtotalEl) subtotalEl.textContent = "0₫";
      return;
    }

    try {
      const ids = cart.map((c) => c.productId).join(",");
      const res = await fetch("/api/cart/products?ids=" + encodeURIComponent(ids));
      const { products } = await res.json();
      const byId = Object.fromEntries(products.map((p) => [p.id, p]));

      let total = 0;
      const rows = cart.map((item, index) => {
        const p = byId[item.productId];
        if (!p) return "";

        let unitPrice;
        let label;
        let attrText = "";
        
        if (item.variantId) {
          const v = (p.variants || []).find((x) => x.id === item.variantId);
          if (!v) return "";
          unitPrice = v.salePrice ? Number(v.salePrice) : Number(v.price);
          const attrs = v.attributes || {};
          attrText = Object.entries(attrs).map(([k, val]) => val).join(" / ");
          label = escapeHtml(p.name);
        } else {
          unitPrice = p.salePrice ? Number(p.salePrice) : Number(p.price);
          label = escapeHtml(p.name);
        }

        total += unitPrice * item.quantity;
        return `
          <div class="flex justify-between items-start gap-4 py-4 border-b border-blue-100/60 last:border-0 group">
              <div class="flex-1 pr-4">
                  <div class="font-medium text-slate-900 text-sm leading-snug mb-1">${label}</div>
                  ${attrText ? `<div class="text-xs text-blue-700/60 mb-1">${escapeHtml(attrText)}</div>` : ''}
                  <div class="text-xs text-slate-900/50 bg-blue-50 inline-block px-2 py-1 rounded-md">${formatMoney(unitPrice)} × ${item.quantity}</div>
              </div>
              <div class="text-right flex flex-col items-end gap-2 shrink-0">
                  <div class="font-medium text-slate-900 text-sm">${formatMoney(unitPrice * item.quantity)}</div>
                  ${buyNowItem ? '' : `<button type="button" data-index="${index}" class="cart-remove text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600 hover:underline">Xoá</button>`}
              </div>
          </div>
        `;
      });

      checkoutItems.innerHTML = rows.join("");
      currentSubtotal = total;
      const subtotalEl = document.getElementById("subtotal-display");
      if(subtotalEl) subtotalEl.textContent = formatMoney(total);
      const finalTotal = appliedCoupon ? Math.max(0, total - appliedCoupon.discountAmount) : total;
      document.getElementById("checkout-total").textContent = formatMoney(finalTotal);
      updateDiscountUI();

      checkoutForm.classList.remove("hidden");

      checkoutItems.querySelectorAll(".cart-remove").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.index);
          writeCart(readCart().filter((_, i) => i !== idx));
          appliedCoupon = null;
          render();
        });
      });
    } catch (e) {
      checkoutItems.innerHTML = "<p class='text-sm text-red-500'>Lỗi tải thông tin sản phẩm.</p>";
    }
  }

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const errorEl = document.getElementById("checkout-error");
    const submitBtn = document.getElementById("checkout-submit-btn");
    
    errorEl.textContent = "";

    const paymentMethod = form.paymentMethod ? form.paymentMethod.value : undefined;
    if (!paymentMethod) {
      errorEl.textContent = "Vui lòng chọn phương thức thanh toán.";
      return;
    }

    const fulfillmentMethod = form.fulfillmentMethod ? form.fulfillmentMethod.value : undefined;
    if (!fulfillmentMethod) {
      errorEl.textContent = "Vui lòng chọn hình thức nhận hàng.";
      return;
    }

    // Loading state
    const originalBtnContent = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="animate-spin inline-block mr-2 w-5 h-5 border-2 border-white border-t-transparent rounded-full"></span> <span class="text-lg">Đang xử lý...</span>';
    submitBtn.classList.add('opacity-80', 'cursor-not-allowed');

    try {
      const cart = readCart();
      const res = await fetch("/cart/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((c) => ({ productId: c.productId, variantId: c.variantId, quantity: c.quantity })),
          customerName: form.customerName.value,
          customerPhone: form.customerPhone.value,
          customerAddress: form.customerAddress.value || undefined,
          customerProvince: fulfillmentMethod === "delivery" ? form.customerProvince.value : undefined,
          fulfillmentMethod,
          storeId: fulfillmentMethod === "pickup" ? (form.storeId ? form.storeId.value : undefined) : undefined,
          paymentMethod,
          couponCode: form.couponCode ? form.couponCode.value : undefined,
          customFields: collectExtraFields(form, [
            "customerName", "customerPhone", "customerAddress", "customerProvince",
            "fulfillmentMethod", "storeId", "paymentMethod", "couponCode",
          ]),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        errorEl.textContent = typeof body.error === "string" ? body.error : "Đặt hàng thất bại, vui lòng kiểm tra lại thông tin.";
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnContent;
        submitBtn.classList.remove('opacity-80', 'cursor-not-allowed');
        return;
      }

      const { orderId, redirectUrl } = await res.json();
      if (buyNowItem) {
        removeOneFromRealCart(buyNowItem);
      } else {
        writeCart([]);
      }
      window.location.href = redirectUrl || "/order-confirmation/" + orderId;
      
    } catch (e) {
      errorEl.textContent = "Lỗi kết nối, vui lòng thử lại sau.";
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnContent;
      submitBtn.classList.remove('opacity-80', 'cursor-not-allowed');
    }
  });

  loadProvinces();
  loadFulfillmentMethods();
  loadPaymentMethods();

  // Fallback Add to Cart via URL (khong ap dung khi dang o che do "Mua ngay" 1 san pham)
  const urlParams = new URLSearchParams(window.location.search);
  const addProductId = buyNowItem ? null : urlParams.get("add_product_id");
  if (addProductId) {
    const addVariantId = urlParams.get("add_variant_id") || undefined;
    const addQuantity = parseInt(urlParams.get("quantity") || "1", 10);
    const cart = readCart();
    
    const existing = cart.find((c) => c.productId === addProductId && c.variantId === addVariantId);
    if (existing) {
      existing.quantity += addQuantity;
    } else {
      cart.push({ productId: addProductId, quantity: addQuantity, variantId: addVariantId });
    }
    writeCart(cart);
    
    const newUrl = window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
  }

  const applyCouponBtn = document.getElementById("apply-coupon-btn");
  const couponInput = document.getElementById("coupon-code-input");
  const couponMessage = document.getElementById("coupon-message");

  function showCouponMessage(text, isError) {
    if (!couponMessage) return;
    couponMessage.textContent = text;
    couponMessage.classList.remove("hidden", "text-red-500", "text-blue-600");
    couponMessage.classList.add(isError ? "text-red-500" : "text-blue-600");
  }

  if (applyCouponBtn && couponInput) {
    applyCouponBtn.addEventListener("click", async () => {
      const code = couponInput.value.trim();
      if (!code) {
        showCouponMessage("Vui lòng nhập mã giảm giá.", true);
        return;
      }
      const originalText = applyCouponBtn.textContent;
      applyCouponBtn.disabled = true;
      applyCouponBtn.textContent = "Đang kiểm tra...";
      try {
        const res = await fetch("/api/cart/apply-coupon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, subtotal: currentSubtotal }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          appliedCoupon = null;
          showCouponMessage(data.error || "Mã giảm giá không hợp lệ.", true);
        } else {
          appliedCoupon = { code, discountAmount: data.discountAmount };
          showCouponMessage(`Áp dụng mã "${code}" thành công.`, false);
        }
      } catch (e) {
        appliedCoupon = null;
        showCouponMessage("Lỗi kết nối, vui lòng thử lại.", true);
      } finally {
        applyCouponBtn.disabled = false;
        applyCouponBtn.textContent = originalText;
        render();
      }
    });
  }

  render();
})();