// JS riêng cho 404.liquid — trống mặc định.
// JS riêng cho blog-category.liquid — trống mặc định.
// JS riêng cho blog-list.liquid — trống mặc định.
(function () {
  const form = document.getElementById("unlock-form");
  const errorBox = document.getElementById("unlock-error");
  const passwordInput = document.getElementById("password");
  if (!form || !errorBox || !passwordInput) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.classList.add("hidden");

    const res = await fetch(window.location.pathname + "/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorBox.textContent = typeof body.error === "string" ? body.error : "Sai mật khẩu";
      errorBox.classList.remove("hidden");
      return;
    }

    window.location.reload();
  });
})();
// JS riêng cho blog-post.liquid — trống mặc định.
(function () {
  const checkoutForm = document.getElementById("checkout-form");
  const checkoutItems = document.getElementById("checkout-items");
  if (!checkoutForm || !checkoutItems) return;

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

  const PAYMENT_METHOD_LABELS = {
    cod: "Thanh toán khi nhận hàng (COD)",
    bank_transfer: "Chuyển khoản ngân hàng",
    vnpay: "Thanh toán online qua VNPay",
  };

  async function loadProvinces() {
    const select = document.querySelector('select[name="customerProvince"]');
    if (!select) return;
    const res = await fetch("/api/provinces");
    const { provinces } = await res.json();
    provinces.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });
  }

  const FULFILLMENT_METHOD_LABELS = {
    delivery: "Giao tận nơi",
    pickup: "Nhận tại cửa hàng",
  };

  function toggleFulfillmentFields(method) {
    document.getElementById("delivery-fields").classList.toggle("hidden", method !== "delivery");
    document.getElementById("pickup-fields").classList.toggle("hidden", method !== "pickup");
    checkoutForm.customerProvince.required = method === "delivery";
    checkoutForm.storeId.required = method === "pickup";
  }

  async function loadFulfillmentMethods() {
    const list = document.getElementById("fulfillment-methods-list");
    const res = await fetch("/api/cart/fulfillment-methods");
    const { methods, stores } = await res.json();

    const storeSelect = document.querySelector('select[name="storeId"]');
    stores.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name + (s.province ? " (" + s.province + ")" : "");
      storeSelect.appendChild(opt);
    });

    if (methods.length === 0) {
      list.innerHTML = "<p>Chưa có hình thức nhận hàng nào được bật.</p>";
      return;
    }
    list.innerHTML = methods
      .map(
        (m, i) =>
          '<label style="display:block;"><input type="radio" name="fulfillmentMethod" value="' +
          m +
          '"' +
          (i === 0 ? " checked" : "") +
          "> " +
          (FULFILLMENT_METHOD_LABELS[m] || m) +
          "</label>",
      )
      .join("");

    list.querySelectorAll('input[name="fulfillmentMethod"]').forEach((radio) => {
      radio.addEventListener("change", () => toggleFulfillmentFields(radio.value));
    });
    toggleFulfillmentFields(methods[0]);
  }

  async function loadPaymentMethods() {
    const list = document.getElementById("payment-methods-list");
    const res = await fetch("/api/cart/payment-methods");
    const { methods } = await res.json();
    if (methods.length === 0) {
      list.innerHTML = "<p>Chưa có phương thức thanh toán nào được bật.</p>";
      return;
    }
    list.innerHTML = methods
      .map(
        (m, i) =>
          '<label style="display:block;"><input type="radio" name="paymentMethod" value="' +
          m.method +
          '"' +
          (i === 0 ? " checked" : "") +
          "> " +
          (PAYMENT_METHOD_LABELS[m.method] || m.method) +
          "</label>",
      )
      .join("");
  }

  async function render() {
    const cart = readCart();

    if (cart.length === 0) {
      cartItems.innerHTML = '<p>Giỏ hàng trống. <a href="/products">Xem sản phẩm</a></p>';
      checkoutForm.classList.add("hidden");
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

      let unitPrice;
      let label;
      if (item.variantId) {
        const v = (p.variants || []).find((x) => x.id === item.variantId);
        if (!v) return "";
        unitPrice = v.salePrice ? Number(v.salePrice) : Number(v.price);
        const attrs = v.attributes || {};
        const attrText = Object.entries(attrs).map(([k, val]) => k + ": " + val).join(", ");
        label = escapeHtml(p.name) + (attrText ? " (" + escapeHtml(attrText) + ")" : "");
      } else {
        unitPrice = p.salePrice ? Number(p.salePrice) : Number(p.price);
        label = escapeHtml(p.name);
      }

      total += unitPrice * item.quantity;
      return (
        "<div>" +
        "<div><div>" + label + "</div><div>" + unitPrice + "₫ × " + item.quantity + "</div></div>" +
        "<div>" +
        "<div>" + (unitPrice * item.quantity) + "₫</div>" +
        '<button data-index="' + index + '" class="cart-remove">Xoá</button>' +
        "</div></div>"
      );
    });

    cartItems.innerHTML = rows.join("");
    document.getElementById("cart-total").textContent = "Tổng cộng: " + total + "₫";
    checkoutForm.classList.toggle("hidden", cart.length === 0);

    cartItems.querySelectorAll(".cart-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.index);
        writeCart(readCart().filter((_, i) => i !== idx));
        render();
      });
    });
  }

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const errorEl = document.getElementById("checkout-error");
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
        storeId: fulfillmentMethod === "pickup" ? form.storeId.value : undefined,
        paymentMethod,
        couponCode: form.couponCode.value || undefined,
        customFields: collectExtraFields(form, [
          "customerName", "customerPhone", "customerAddress", "customerProvince",
          "fulfillmentMethod", "storeId", "paymentMethod", "couponCode", "cf-turnstile-response"
        ]),
        turnstileToken: form.elements["cf-turnstile-response"] ? form.elements["cf-turnstile-response"].value : undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      errorEl.textContent = err.error || "Có lỗi xảy ra. Vui lòng thử lại.";
      if (window.turnstile) {
        window.turnstile.reset();
      }
      return;
    }

    const { orderId, redirectUrl } = await res.json();
    writeCart([]);
    window.location.href = redirectUrl || "/order-confirmation/" + orderId;
  });

  loadProvinces();
  loadFulfillmentMethods();
  loadPaymentMethods();
  render();
})();
// JS riêng cho custom-fields.liquid — trống mặc định.
// JS riêng cho footer.liquid — trống mặc định.
// JS riêng cho header.liquid — trống mặc định.
// JS riêng cho home.liquid — trống mặc định.
document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".plugin-action-form");
  if (!form) return;
  event.preventDefault();

  const message = form.querySelector(".plugin-action-form__message");
  const submitButton = form.querySelector('button[type="submit"]');
  const payload = {};

  new FormData(form).forEach((value, key) => {
    payload[key] = value;
  });

  if (submitButton) submitButton.disabled = true;
  if (message) message.textContent = "Submitting...";

  try {
    const res = await fetch("/api/plugins/" + encodeURIComponent(form.dataset.pluginSlug) + "/actions/" + encodeURIComponent(form.dataset.actionKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Submit failed");
    form.reset();
    if (message) message.textContent = body.message || "Submitted.";
  } catch (err) {
    if (message) message.textContent = err.message || "Submit failed";
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});
// JS riêng cho order-confirmation.liquid — trống mặc định.
// JS riêng cho page.liquid — trống mặc định.
// JS riêng cho product-category.liquid — trống mặc định.
(function () {
  const productRoot = document.querySelector("[data-product-id]");
  if (!productRoot) return;

  const productId = productRoot.dataset.productId;
  const reviewForm = document.getElementById("review-form");
  if (reviewForm) {
    reviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.target;
      const msg = document.getElementById("review-msg");
      const res = await fetch("/products/" + productId + "/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.customerName.value,
          rating: Number(form.rating.value),
          comment: form.comment.value || undefined,
        }),
      });
      if (!res.ok) {
        msg.textContent = "Gửi thất bại, vui lòng thử lại.";
        return;
      }
      msg.textContent = "Cảm ơn bạn! Đánh giá đang chờ duyệt.";
      form.reset();
    });
  }

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

  function addToCart(selectedProductId, variantId) {
    const cart = readCart();
    const existing = cart.find((c) => c.productId === selectedProductId && c.variantId === variantId);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({ productId: selectedProductId, quantity: 1, variantId: variantId || undefined });
    }
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    const msg = document.getElementById("add-to-cart-msg");
    if (msg) msg.textContent = "Đã thêm vào giỏ — xem giỏ hàng";
  }

  function initBuyNow(getVariantId) {
    const btn = document.getElementById("buy-now-btn");
    const form = document.getElementById("buy-now-form");
    const cancelBtn = document.getElementById("buy-now-cancel");
    const errorEl = document.getElementById("buy-now-error");
    if (!btn || !form || !productId) return;

    btn.addEventListener("click", () => {
      form.classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    cancelBtn.addEventListener("click", () => form.classList.add("hidden"));

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.textContent = "";
      const variantId = getVariantId();

      const res = await fetch("/cart/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId, variantId: variantId || undefined, quantity: 1 }],
          customerName: form.customerName.value,
          customerPhone: form.customerPhone.value,
          customerAddress: form.customerAddress.value || undefined,
          customFields: collectExtraFields(form, ["customerName", "customerPhone", "customerAddress"]),
        }),
      });

      if (!res.ok) {
        errorEl.textContent = "Đặt hàng thất bại, vui lòng thử lại.";
        return;
      }

      const { orderId } = await res.json();
      const cart = readCart().filter((c) => !(c.productId === productId && c.variantId === variantId));
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      window.location.href = "/order-confirmation/" + orderId;
    });
  }

  const variantsEl = document.getElementById("variants-data");

  if (variantsEl) {
    const variants = JSON.parse(variantsEl.textContent);
    const attrNames = [...new Set(variants.flatMap((v) => Object.keys(v.attributes || {})))];
    const picker = document.getElementById("variant-picker");
    const priceEl = document.getElementById("variant-price");
    const stockEl = document.getElementById("variant-stock");
    const addBtn = document.getElementById("add-to-cart");
    const selected = {};

    function findMatchingVariant() {
      return variants.find((v) => attrNames.every((name) => (v.attributes || {})[name] === selected[name]));
    }

    function render() {
      const v = findMatchingVariant();
      if (!v) {
        priceEl.textContent = "";
        stockEl.textContent = "";
        addBtn.disabled = true;
        return;
      }
      priceEl.innerHTML = v.salePrice
        ? "<span>" + v.salePrice + "₫</span> <span>" + v.price + "₫</span>"
        : "<span>" + v.price + "₫</span>";
      const outOfStock = v.stock !== null && v.stock !== undefined && v.stock <= 0;
      stockEl.textContent = outOfStock ? "Hết hàng" : "";
      addBtn.disabled = outOfStock;
      addBtn.dataset.variantId = v.id;
    }

    attrNames.forEach((name) => {
      const values = [...new Set(variants.map((v) => (v.attributes || {})[name]).filter(Boolean))];
      selected[name] = values[0];

      const wrap = document.createElement("div");
      const label = document.createElement("label");
      label.textContent = name + ": ";
      wrap.appendChild(label);

      const select = document.createElement("select");
      values.forEach((val) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => {
        selected[name] = select.value;
        render();
      });
      wrap.appendChild(select);
      picker.appendChild(wrap);
    });

    render();

    addBtn.addEventListener("click", () => {
      if (addBtn.disabled) return;
      addToCart(productId, addBtn.dataset.variantId);
    });

    initBuyNow(() => addBtn.dataset.variantId || null);
  } else {
    const btn = document.getElementById("add-to-cart");
    if (btn) {
      btn.addEventListener("click", () => addToCart(btn.dataset.id, null));
    }
    initBuyNow(() => null);
  }
})();
// JS riêng cho products-list.liquid — trống mặc định.
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
      
      // Optional: show a message if there's a span inside the button, or just open cart
      const msg = addBtn.querySelector(".add-to-cart-msg");
      if (msg) {
        msg.textContent = "Đã thêm";
        setTimeout(() => (msg.textContent = ""), 2000);
      }
      
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





(function() {
  const containers = document.querySelectorAll(".plugin-chat-container");
  if (!containers.length) return;

  containers.forEach(container => {
    const toggleBtn = container.querySelector(".plugin-chat-toggle");
    const drawer = container.querySelector(".plugin-chat-drawer");
    const closeBtn = container.querySelector(".plugin-chat-close");
    const form = container.querySelector(".plugin-chat-form");
    const input = container.querySelector(".plugin-chat-input");
    const messagesEl = container.querySelector(".plugin-chat-messages");
    const pluginSlug = container.getAttribute("data-plugin-slug");

    let historyLoaded = false;
    let nextCursor = null;
    let isLoadingHistory = false;

    const fetchHistory = async (cursor = null) => {
      if (isLoadingHistory) return;
      isLoadingHistory = true;

      let sessionId = localStorage.getItem("site_engine_chat_session") || container.getAttribute("data-session-id");
      let hmacToken = localStorage.getItem("site_engine_chat_hmac") || container.getAttribute("data-hmac");
      
      if (sessionId && hmacToken) {
        try {
          const url = `/api/plugins/${pluginSlug}/chat?sessionId=${encodeURIComponent(sessionId)}&hmacToken=${encodeURIComponent(hmacToken)}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
          const res = await fetch(url);
          
          if (res.ok) {
            const data = await res.json();
            nextCursor = data.nextCursor;

            if (data.history && data.history.length > 0) {
              const oldScrollHeight = messagesEl.scrollHeight;
              
              if (!cursor) messagesEl.innerHTML = ''; // Initial load, clear default
              
              // To prepend correctly without reversing the DOM sequence, we prepend them in reverse chronological order
              // Wait, the API returns chronological order [oldest, ..., newest].
              // If we prepend 'newest' first, then 'oldest', it will be: oldest, ..., newest, existing.
              if (cursor) {
                // If we are prepending (loading older messages), we iterate backwards so they stack correctly at the top
                for (let i = data.history.length - 1; i >= 0; i--) {
                  appendMessage(data.history[i].content, data.history[i].role === 'user', true);
                }
                // Keep the scroll position
                messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
              } else {
                // Initial load, just append
                data.history.forEach(msg => {
                  appendMessage(msg.content, msg.role === 'user');
                });
              }
            }
          }
        } catch (e) {
          console.error("Failed to load chat history", e);
        }
      }
      isLoadingHistory = false;
    };

    // Scroll event for lazy loading
    messagesEl.addEventListener("scroll", () => {
      if (messagesEl.scrollTop === 0 && nextCursor && !isLoadingHistory) {
        fetchHistory(nextCursor);
      }
    });
    
    // Toggle drawer
    toggleBtn.addEventListener("click", async () => {
      drawer.classList.remove("hidden");
      input.focus();

      if (!historyLoaded) {
        historyLoaded = true;
        await fetchHistory();
      }
    });

    closeBtn.addEventListener("click", () => {
      drawer.classList.add("hidden");
    });

    // Add message helper (can prepend or append)
    const appendMessage = (text, isUser, prepend = false) => {
      const msg = document.createElement("div");
      msg.className = "plugin-chat-message " + (isUser ? "user" : "assistant");
      msg.textContent = text;
      if (prepend) {
        messagesEl.insertBefore(msg, messagesEl.firstChild);
      } else {
        messagesEl.appendChild(msg);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    };

    // Form submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      input.value = "";
      input.disabled = true;
      const submitBtn = form.querySelector('.plugin-chat-submit');
      if (submitBtn) submitBtn.disabled = true;
      appendMessage(text, true);

      // Loading state — dots via CSS ::after
      const loading = document.createElement("div");
      loading.className = "plugin-chat-message assistant loading";
      messagesEl.appendChild(loading);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // Lấy token bảo mật: Ưu tiên LocalStorage, nếu chưa có thì lấy từ DOM và lưu lại
      let sessionId = localStorage.getItem("site_engine_chat_session");
      let hmacToken = localStorage.getItem("site_engine_chat_hmac");

      if (!sessionId || !hmacToken) {
        sessionId = container.getAttribute("data-session-id");
        hmacToken = container.getAttribute("data-hmac");
        if (sessionId && hmacToken) {
          localStorage.setItem("site_engine_chat_session", sessionId);
          localStorage.setItem("site_engine_chat_hmac", hmacToken);
        }
      }

      const turnstileInput = container.querySelector("[name='cf-turnstile-response']");
      const turnstileToken = turnstileInput ? turnstileInput.value : undefined;

      try {
        const res = await fetch(`/api/plugins/${pluginSlug}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentKey: "customer", // The plugin uses 'customer' agent
            sessionId: sessionId,
            hmacToken: hmacToken,
            turnstileToken: turnstileToken,
            message: text
          })
        });
        
        loading.remove();
        
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          appendMessage("Lỗi: " + (err.error || "Không thể kết nối với CSKH"), false);
          
          // Reset turnstile if failed
          if (window.turnstile) {
            window.turnstile.reset();
          }
          return;
        }

        const data = await res.json();
        appendMessage(data.text, false);
      } catch (err) {
        loading.remove();
        appendMessage("Lỗi kết nối mạng.", false);
      } finally {
        input.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
        input.focus();
      }
    });
  });
})();
