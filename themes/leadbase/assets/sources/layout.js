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

// Animation: Flying number to cart icon
window.flyToCart = function(sourceElement) {
    // Try to find the cart icon in header or cart drawer trigger
    const cartIcon = document.getElementById('cart-icon');
    if (!cartIcon || !sourceElement) return;

    const sourceRect = sourceElement.getBoundingClientRect();
    const targetRect = cartIcon.getBoundingClientRect();

    const flyingElement = document.createElement('div');
    flyingElement.className = 'fly-to-cart';
    flyingElement.textContent = '+1';
    
    // Start position
    flyingElement.style.left = `${sourceRect.left + sourceRect.width / 2 - 15}px`;
    flyingElement.style.top = `${sourceRect.top + sourceRect.height / 2 - 15}px`;
    
    document.body.appendChild(flyingElement);

    // Trigger reflow
    void flyingElement.offsetWidth;

    // End position
    flyingElement.style.left = `${targetRect.left + targetRect.width / 2 - 15}px`;
    flyingElement.style.top = `${targetRect.top + targetRect.height / 2 - 15}px`;
    flyingElement.style.transform = 'scale(0.5)';
    flyingElement.style.opacity = '0.2';

    // Add brief animation to cart icon upon arrival
    setTimeout(() => {
        flyingElement.remove();
        cartIcon.style.transform = 'scale(1.2)';
        cartIcon.style.transition = 'transform 0.2s ease';
        setTimeout(() => {
            cartIcon.style.transform = 'scale(1)';
        }, 200);
    }, 800);
};

// Listen for global custom event for adding to cart
document.addEventListener('add-to-cart-success', (e) => {
    if (e.detail && e.detail.source) {
        window.flyToCart(e.detail.source);
    }
});

// Accessibility fixes for dynamically generated content (e.g. rich text editor)
document.addEventListener("DOMContentLoaded", () => {
    // Add aria-label to lightbox links missing discernible text
    document.querySelectorAll("a.image-lightbox").forEach(a => {
        if (!a.getAttribute("aria-label") && !a.textContent.trim()) {
            a.setAttribute("aria-label", "Phóng to ảnh");
        }
    });

    // Add generic alt text to images missing it
    document.querySelectorAll("img").forEach(img => {
        if (!img.hasAttribute("alt") || img.getAttribute("alt").trim() === "") {
            img.setAttribute("alt", "Hình ảnh minh họa");
        }
    });

    // Infinite Scroll Logic for Products and Blogs
    const initInfiniteScroll = () => {
        let paginationContainer = document.querySelector('.pagination-container');
        if (!paginationContainer) return;

        const sampleItem = document.querySelector('article');
        if (!sampleItem) return;
        const gridContainer = sampleItem.parentElement;

        let isFetching = false;

        const observer = new IntersectionObserver(async (entries) => {
            const entry = entries[0];
            if (entry.isIntersecting && !isFetching) {
                const nextLink = Array.from(paginationContainer.querySelectorAll('a')).find(a => a.textContent.includes('Trang sau'));
                if (nextLink) {
                    isFetching = true;
                    paginationContainer.style.minHeight = paginationContainer.offsetHeight + 'px';
                    const originalHTML = paginationContainer.innerHTML;
                    
                    paginationContainer.innerHTML = '<div class="flex justify-center p-4 w-full"><svg class="animate-spin h-8 w-8 text-[#43a047]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg></div>';
                    paginationContainer.style.opacity = '1';

                    try {
                        const res = await fetch(nextLink.href);
                        if (!res.ok) throw new Error('Fetch failed');
                        const html = await res.text();
                        const doc = new DOMParser().parseFromString(html, 'text/html');
                        
                        const newItems = doc.querySelectorAll('article');
                        newItems.forEach(item => {
                            gridContainer.appendChild(item);
                            item.style.opacity = '1';
                        });

                        const newPagination = doc.querySelector('.pagination-container');
                        if (newPagination) {
                            paginationContainer.replaceWith(newPagination);
                            paginationContainer = document.querySelector('.pagination-container');
                            observer.observe(paginationContainer);
                        } else {
                            paginationContainer.remove();
                        }
                    } catch (error) {
                        console.error('Infinite scroll error:', error);
                        paginationContainer.innerHTML = originalHTML;
                        observer.observe(paginationContainer);
                    } finally {
                        isFetching = false;
                    }
                }
            }
        }, { rootMargin: '400px' });

        observer.observe(paginationContainer);
    };
    initInfiniteScroll();
});