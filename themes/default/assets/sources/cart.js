(function () {
  const checkoutForm = document.getElementById("checkout-form");
  const cartItems = document.getElementById("cart-items");
  if (!checkoutForm || !cartItems) return;

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
          "fulfillmentMethod", "storeId", "paymentMethod", "couponCode",
        ]),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = typeof body.error === "string" ? body.error : "Đặt hàng thất bại, vui lòng thử lại.";
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
