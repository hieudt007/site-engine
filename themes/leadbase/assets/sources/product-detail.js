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
      const submitBtn = form.querySelector('button[type="submit"]');
      
      if(submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="animate-spin inline-block mr-2">↻</span> Đang gửi...';
      }

      try {
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
          msg.innerHTML = '<span class="text-destructive text-sm mt-2 block">Gửi thất bại, vui lòng thử lại.</span>';
        } else {
          msg.innerHTML = '<span class="text-brand font-medium text-sm mt-2 block">Cảm ơn bạn! Đánh giá đang chờ duyệt.</span>';
          form.reset();
        }
      } catch (error) {
        msg.innerHTML = '<span class="text-destructive text-sm mt-2 block">Lỗi kết nối, vui lòng thử lại sau.</span>';
      } finally {
        if(submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Gửi đánh giá';
        }
      }
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
    
    // Trigger event for Cart Drawer if exists
    window.dispatchEvent(new Event('cartUpdated'));

    const msg = document.getElementById("add-to-cart-msg");
    if (msg) {
      msg.innerHTML = `
        <div class="mt-4 p-4 bg-brand/10 border border-brand/20 rounded-[24px] text-brand text-sm flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <span class="flex items-center gap-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Đã thêm vào giỏ hàng</span> 
          <a href="/cart" class="font-medium underline hover:text-brand-dark transition-colors">Xem giỏ hàng</a>
        </div>`;
      setTimeout(() => { msg.innerHTML = ''; }, 5000);
    }
  }

  function flyToCart(buttonEl) {
    const root = buttonEl.closest('[data-product-id]');
    if (!root) return;
    
    const img = root.querySelector('img');
    const cartIcon = document.querySelector('header a[href="/cart"], header .cart-toggle');
    
    if (!img || !cartIcon) return;

    const imgRect = img.getBoundingClientRect();
    const cartRect = cartIcon.getBoundingClientRect();

    const flyingImg = document.createElement('img');
    flyingImg.src = img.src;
    flyingImg.className = 'flying-image';
    
    const startSize = Math.min(imgRect.width, 150);
    
    flyingImg.style.width = `${startSize}px`;
    flyingImg.style.height = `${startSize}px`;
    flyingImg.style.left = `${imgRect.left + (imgRect.width / 2) - (startSize / 2)}px`;
    flyingImg.style.top = `${imgRect.top + (imgRect.height / 2) - (startSize / 2)}px`;
    
    document.body.appendChild(flyingImg);
    
    // Force reflow
    flyingImg.getBoundingClientRect();
    
    const targetSize = 24;
    flyingImg.style.left = `${cartRect.left + (cartRect.width / 2) - (targetSize / 2)}px`;
    flyingImg.style.top = `${cartRect.top + (cartRect.height / 2) - (targetSize / 2)}px`;
    flyingImg.style.width = `${targetSize}px`;
    flyingImg.style.height = `${targetSize}px`;
    flyingImg.style.opacity = '0';
    flyingImg.style.transform = 'scale(0.1) rotate(360deg)';
    
    setTimeout(() => {
      flyingImg.remove();
    }, 800);
  }

  function initBuyNow(getVariantId) {
    const btn = document.getElementById("buy-now-btn");
    const form = document.getElementById("buy-now-form");
    const cancelBtn = document.getElementById("buy-now-cancel");
    const errorEl = document.getElementById("buy-now-error");
    if (!btn || !form || !productId) return;

    btn.addEventListener("click", () => {
      form.classList.remove("hidden");
      setTimeout(() => {
        form.classList.add("opacity-100", "translate-y-0");
        form.classList.remove("opacity-0", "-translate-y-4");
      }, 10);
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    cancelBtn.addEventListener("click", () => {
      form.classList.add("opacity-0", "-translate-y-4");
      form.classList.remove("opacity-100", "translate-y-0");
      setTimeout(() => form.classList.add("hidden"), 300);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorEl.textContent = "";
      const variantId = getVariantId();
      const submitBtn = form.querySelector('button[type="submit"]');

      if(submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="animate-spin inline-block mr-2">↻</span> Đang xử lý...';
      }

      try {
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
          errorEl.innerHTML = '<span class="text-destructive mt-2 block text-sm">Đặt hàng thất bại, vui lòng kiểm tra lại thông tin.</span>';
          if(submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Xác nhận đặt hàng';
          }
          return;
        }

        const { orderId } = await res.json();
        const cart = readCart().filter((c) => !(c.productId === productId && c.variantId === variantId));
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        window.location.href = "/order-confirmation/" + orderId;
      } catch (error) {
        errorEl.innerHTML = '<span class="text-destructive mt-2 block text-sm">Lỗi kết nối, vui lòng thử lại sau.</span>';
        if(submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Xác nhận đặt hàng';
        }
      }
    });
  }

  const variantsEl = document.getElementById("variants-data");
  const variantsText = variantsEl ? variantsEl.textContent.trim() : "";

  if (variantsEl && variantsText) {
    const variants = JSON.parse(variantsText);
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
        priceEl.innerHTML = '<span class="text-muted-foreground italic text-lg">Phiên bản không tồn tại</span>';
        stockEl.textContent = "";
        addBtn.disabled = true;
        addBtn.classList.add("opacity-50", "cursor-not-allowed");
        return;
      }
      
      if (v.salePrice) {
        priceEl.innerHTML = `
          <span class="text-3xl md:text-4xl font-serif text-brand-dark font-medium tracking-tight">${v.salePrice.toLocaleString('vi-VN')}₫</span>
          <span class="text-xl text-muted-foreground line-through ml-3">${v.price.toLocaleString('vi-VN')}₫</span>
        `;
      } else {
        priceEl.innerHTML = `<span class="text-3xl md:text-4xl font-serif text-brand-dark font-medium tracking-tight">${v.price.toLocaleString('vi-VN')}₫</span>`;
      }

      const outOfStock = v.stock !== null && v.stock !== undefined && v.stock <= 0;
      
      if (outOfStock) {
        stockEl.innerHTML = '<span class="inline-flex items-center px-3 py-1 rounded-[24px] text-xs font-medium bg-destructive/10 text-destructive mt-3 border border-destructive/20">Hết hàng</span>';
        addBtn.disabled = true;
        addBtn.classList.add("opacity-50", "cursor-not-allowed");
        addBtn.textContent = "Hết hàng";
      } else {
        stockEl.innerHTML = v.stock ? `<span class="inline-flex items-center px-3 py-1 rounded-[24px] text-xs font-medium bg-brand/10 text-brand mt-3 border border-brand/20">Còn ${v.stock} sản phẩm</span>` : '<span class="inline-flex items-center px-3 py-1 rounded-[24px] text-xs font-medium bg-brand/10 text-brand mt-3 border border-brand/20">Còn hàng</span>';
        addBtn.disabled = false;
        addBtn.classList.remove("opacity-50", "cursor-not-allowed");
        addBtn.textContent = "Thêm vào giỏ hàng";
      }
      
      addBtn.dataset.variantId = v.id;
    }

    // Custom UI for variant picker (Pills instead of Select)
    picker.innerHTML = '';
    picker.className = "flex flex-col gap-6 w-full";
    
    attrNames.forEach((name) => {
      const values = [...new Set(variants.map((v) => (v.attributes || {})[name]).filter(Boolean))];
      selected[name] = values[0];

      const wrap = document.createElement("div");
      wrap.className = "variant-group";
      
      const label = document.createElement("label");
      label.className = "block text-xs font-semibold text-brand-dark mb-3 uppercase tracking-[0.1em]";
      label.textContent = name;
      wrap.appendChild(label);

      const optionsWrap = document.createElement("div");
      optionsWrap.className = "flex flex-wrap gap-3";

      values.forEach((val) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const baseClasses = "px-5 py-2.5 border rounded-[24px] text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-brand/50 font-medium";
        const activeClasses = "border-brand bg-brand text-white shadow-[0_4px_12px_rgba(5,150,105,0.2)]";
        const inactiveClasses = "border-brand/20 text-foreground hover:border-brand/50 hover:bg-brand/5 bg-white/50";
        
        btn.className = `${baseClasses} ${val === selected[name] ? activeClasses : inactiveClasses}`;
        btn.textContent = val;
        
        btn.addEventListener("click", () => {
          selected[name] = val;
          Array.from(optionsWrap.children).forEach(child => {
            child.className = `${baseClasses} ${child.textContent === val ? activeClasses : inactiveClasses}`;
          });
          render();
        });
        
        optionsWrap.appendChild(btn);
      });
      
      wrap.appendChild(optionsWrap);
      picker.appendChild(wrap);
    });

    render();

    addBtn.addEventListener("click", () => {
      if (addBtn.disabled) return;
      const originalText = addBtn.textContent;
      addBtn.innerHTML = '<span class="animate-spin inline-block mr-2">↻</span> Đang thêm...';
      addBtn.disabled = true;
      
      flyToCart(addBtn);
      
      setTimeout(() => {
        addToCart(productId, addBtn.dataset.variantId);
        addBtn.innerHTML = '✓ Đã thêm';
        addBtn.classList.add("bg-brand-dark");
        
        setTimeout(() => {
          addBtn.textContent = originalText;
          addBtn.disabled = false;
          addBtn.classList.remove("bg-brand-dark");
        }, 2000);
      }, 500);
    });

    initBuyNow(() => addBtn.dataset.variantId || null);
  } else {
    const btn = document.getElementById("add-to-cart");
    if (btn) {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const originalText = btn.textContent;
        btn.innerHTML = '<span class="animate-spin inline-block mr-2">↻</span> Đang thêm...';
        btn.disabled = true;
        
        flyToCart(btn);
        
        setTimeout(() => {
          addToCart(btn.dataset.id, null);
          btn.innerHTML = '✓ Đã thêm';
          btn.classList.add("bg-brand-dark");
          
          setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
            btn.classList.remove("bg-brand-dark");
          }, 2000);
        }, 500);
      });
    }
    initBuyNow(() => null);
  }
})();