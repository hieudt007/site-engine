(function () {
  const productRoot = document.querySelector("[data-product-id]");
  if (!productRoot) return;

  const productId = productRoot.dataset.productId;

  // Icon gio hang tren nut "Them vao gio" - PHAI khop y het svg tinh trong purchase.liquid. Dung
  // chung hang so nay moi noi can doi lai chu/icon cua nut (render() bien the, click handler...)
  // de khong bao gio vo tinh xoa mat icon qua .textContent/.innerHTML tren ca button.
  const cartIconSvg = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 3h1.386c.51 0 .955.343 1.087.836l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 1.994-4.708 2.602-7.201.232-.95-.611-1.85-1.593-1.85H5.106M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"></path></svg>';
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
          msg.innerHTML = '<span class="text-red-600 text-sm mt-2 block">Gửi thất bại, vui lòng thử lại.</span>';
        } else {
          msg.innerHTML = '<span class="text-brand font-medium text-sm mt-2 block">Cảm ơn bạn! Đánh giá đang chờ duyệt.</span>';
          form.reset();
        }
      } catch (error) {
        msg.innerHTML = '<span class="text-red-600 text-sm mt-2 block">Lỗi kết nối, vui lòng thử lại sau.</span>';
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

  // Dung rieng cho "Mua ngay" - CHI them vao gio khi san pham/bien the nay CHUA co san, khong
  // dung addToCart() vi ham do luon +1 so luong neu da ton tai (khong hop ly cho luong mua ngay:
  // khach da co san pham nay trong gio thi giu nguyen so luong ho da chon, khong tu y cong them).
  function addToCartIfAbsent(selectedProductId, variantId) {
    const cart = readCart();
    const existing = cart.find((c) => c.productId === selectedProductId && c.variantId === variantId);
    if (existing) return;
    cart.push({ productId: selectedProductId, quantity: 1, variantId: variantId || undefined });
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cartUpdated'));
  }

  function flyToCart(buttonEl) {
    const root = buttonEl.closest('[data-product-id]');
    if (!root) return;
    
    const img = root.querySelector('img');
    const cartIcon = document.getElementById('cart-icon');
    
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

  // "Mua ngay" van them san pham vao gio hang that (localStorage) truoc - de neu khach roi trang
  // checkout ma khong dat hang thi san pham van con trong gio, khong bi mat/phai them lai. Neu san
  // pham/bien the nay DA co san trong gio thi bo qua, khong cong don so luong (xem
  // addToCartIfAbsent). Sau do chuyen sang /checkout?buyNowProductId=...&buyNowVariantId=... de
  // trang checkout (checkout.js) CHI hien thi/dat hang dung san pham nay trong lan checkout nay,
  // khong tron voi cac san pham khac dang co san trong gio (xem ghi chu buyNowItem trong
  // checkout.js). Khong con modal/form rieng nua (buy-now-modal trong purchase.liquid la markup
  // cu, khong con JS nao mo no).
  function initBuyNow(getVariantId) {
    const trigger = document.getElementById("buy-now-trigger");
    if (!trigger || !productId) return;

    trigger.addEventListener("click", () => {
      if (trigger.disabled) return;
      const variantId = getVariantId();
      addToCartIfAbsent(productId, variantId);
      const params = new URLSearchParams();
      params.set("buyNowProductId", productId);
      if (variantId) params.set("buyNowVariantId", variantId);
      window.location.href = "/checkout?" + params.toString();
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
    const buyNowTrigger = document.getElementById("buy-now-trigger");
    const selected = {};

    function findMatchingVariant() {
      return variants.find((v) => attrNames.every((name) => (v.attributes || {})[name] === selected[name]));
    }

    function render() {
      const v = findMatchingVariant();
      if (!v) {
        priceEl.innerHTML = '<span class="text-slate-400 italic text-lg">Phiên bản không tồn tại</span>';
        stockEl.textContent = "";
        addBtn.disabled = true;
        addBtn.classList.add("opacity-50", "cursor-not-allowed");
        if (buyNowTrigger) {
          buyNowTrigger.disabled = true;
          buyNowTrigger.classList.add("opacity-50", "cursor-not-allowed");
        }
        return;
      }
      
      // v.salePrice/v.price la string (JSON.stringify Prisma Decimal) - PHAI Number() truoc khi
      // toLocaleString(), goi thang tren string chi tra ve nguyen chuoi, khong co dau phan cach.
      // Class phai khop y het gia tinh trong purchase.liquid (text-3xl/text-slate-950 cho gia
      // chinh, text-lg/text-slate-900/40 cho gia gach ngang) de khong lech font-size/mau giua
      // san pham co bien the va san pham don.
      if (v.salePrice) {
        priceEl.innerHTML = `
          <span class="text-3xl font-sans font-medium text-slate-950 tracking-tight">${Number(v.salePrice).toLocaleString('vi-VN')}₫</span>
          <span class="text-lg text-slate-900/40 line-through decoration-1 ml-3">${Number(v.price).toLocaleString('vi-VN')}₫</span>
        `;
      } else {
        priceEl.innerHTML = `<span class="text-3xl font-sans font-medium text-slate-950 tracking-tight">${Number(v.price).toLocaleString('vi-VN')}₫</span>`;
      }

      const outOfStock = v.stock !== null && v.stock !== undefined && v.stock <= 0;
      
      // Chi doi noi dung cai <span> con (giu nguyen the <div> overlay hover-fill la sibling cua
      // no trong purchase.liquid) - neu gan addBtn.innerHTML truc tiep se xoa mat ca div overlay.
      const addBtnLabel = addBtn.querySelector("span") || addBtn;

      // Class phai khop y het #variant-stock tinh trong purchase.liquid (chu tron + cham
      // pulsing ben canh, KHONG phai dang pill/badge co vien) de khong lech kieu hien thi giua
      // san pham co bien the va san pham don.
      if (outOfStock) {
        stockEl.className = "text-sm font-medium text-red-600 uppercase tracking-wider";
        stockEl.textContent = "Hết hàng";
        addBtn.disabled = true;
        addBtn.classList.add("opacity-50", "cursor-not-allowed");
        addBtnLabel.innerHTML = `${cartIconSvg}Hết hàng`;
        if (buyNowTrigger) {
          buyNowTrigger.disabled = true;
          buyNowTrigger.classList.add("opacity-50", "cursor-not-allowed");
        }
      } else {
        stockEl.className = "text-xs font-medium text-blue-800 uppercase tracking-wider";
        stockEl.textContent = v.stock ? `Còn ${v.stock} sản phẩm` : "Còn hàng";
        addBtn.disabled = false;
        addBtn.classList.remove("opacity-50", "cursor-not-allowed");
        addBtnLabel.innerHTML = `${cartIconSvg}Thêm vào giỏ`;
        if (buyNowTrigger) {
          buyNowTrigger.disabled = false;
          buyNowTrigger.classList.remove("opacity-50", "cursor-not-allowed");
        }
      }

      addBtn.dataset.variantId = v.id;
    }

    // Custom UI for variant picker (Pills instead of Select) - PHAI dung #custom-variant-container
    // (dung theo purchase.liquid), KHONG dung #variant-picker (the <select> that chi de luu
    // <option> danh sach bien the theo contract, van phai giu "hidden" - append div/button vao no
    // se khong hien thi dung vi trinh duyet chi render option/optgroup ben trong select).
    const pickerUI = document.getElementById("custom-variant-container") || picker;
    pickerUI.innerHTML = '';
    pickerUI.className = "flex flex-col gap-6 w-full";

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
      pickerUI.appendChild(wrap);
    });

    render();

    addBtn.addEventListener("click", () => {
      if (addBtn.disabled) return;
      const label = addBtn.querySelector("span") || addBtn;
      label.innerHTML = '<span class="animate-spin inline-block mr-2">↻</span> Đang thêm...';
      addBtn.disabled = true;

      flyToCart(addBtn);

      setTimeout(() => {
        addToCart(productId, addBtn.dataset.variantId);
        label.innerHTML = "✓ Đã thêm";
        addBtn.classList.add("bg-brand-dark");

        setTimeout(() => {
          label.innerHTML = `${cartIconSvg}Thêm vào giỏ`;
          addBtn.disabled = false;
          addBtn.classList.remove("bg-brand-dark");
        }, 2000);
      }, 500);
    });

    initBuyNow(() => addBtn.dataset.variantId || null);
  } else {
    const btn = document.getElementById("add-to-cart");
    if (btn) {
      // San pham KHONG bien the truoc gio chua tung disable nut khi het hang (chi variant moi
      // co) - stock rong/khong co nghia "khong theo doi ton kho", luon cho mua; stock <= 0 moi
      // khoa nut, khop dung logic hien "Het hang" o purchase.liquid.
      const stockRaw = btn.dataset.stock;
      const stock = stockRaw !== "" && stockRaw !== undefined ? Number(stockRaw) : null;
      if (stock !== null && stock <= 0) {
        btn.disabled = true;
        btn.classList.add("opacity-50", "cursor-not-allowed");
        const buyNowTrigger = document.getElementById("buy-now-trigger");
        if (buyNowTrigger) {
          buyNowTrigger.disabled = true;
          buyNowTrigger.classList.add("opacity-50", "cursor-not-allowed");
        }
      }

      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const label = btn.querySelector("span") || btn;
        label.innerHTML = '<span class="animate-spin inline-block mr-2">↻</span> Đang thêm...';
        btn.disabled = true;

        flyToCart(btn);

        setTimeout(() => {
          addToCart(btn.dataset.id, null);
          label.innerHTML = "✓ Đã thêm";
          btn.classList.add("bg-brand-dark");

          setTimeout(() => {
            label.innerHTML = `${cartIconSvg}Thêm vào giỏ`;
            btn.disabled = false;
            btn.classList.remove("bg-brand-dark");
          }, 2000);
        }, 500);
      });
    }
    initBuyNow(() => null);
  }
})();