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
