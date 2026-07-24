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
                  const r = data.history[i];
                  appendMessage(r.content, r.role === 'user', true);
                  if (r.images && r.images.length > 0) {
                    // Prepend images in reverse too
                    for (let j = r.images.length - 1; j >= 0; j--) {
                      appendImage(r.images[j], r.role === 'user', true);
                    }
                  }
                }
                // Keep the scroll position
                messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
              } else {
                // Initial load, just append
                data.history.forEach(r => {
                  appendMessage(r.content, r.role === 'user');
                  if (r.images && r.images.length > 0) {
                    r.images.forEach(img => appendImage(img, r.role === 'user'));
                  }
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
    
    // Tooltip logic
    const tooltip = container.querySelector(".plugin-chat-tooltip");
    const tooltipClose = container.querySelector(".plugin-chat-tooltip-close");
    let tooltipTimeout, tooltipHideTimeout;

    if (tooltip) {
      tooltipTimeout = setTimeout(() => {
        if (drawer.classList.contains("hidden")) {
          tooltip.classList.remove("hidden");
          tooltipHideTimeout = setTimeout(() => {
            tooltip.classList.add("hidden");
          }, 5000);
        }
      }, 10000);
      
      if (tooltipClose) {
        tooltipClose.addEventListener("click", (e) => {
          e.stopPropagation();
          tooltip.classList.add("hidden");
          clearTimeout(tooltipHideTimeout);
        });
      }
    }

    // Toggle drawer
    toggleBtn.addEventListener("click", async () => {
      drawer.classList.remove("hidden");
      input.focus();
      
      if (tooltip) {
        tooltip.classList.add("hidden");
        clearTimeout(tooltipTimeout);
        clearTimeout(tooltipHideTimeout);
      }

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
      if (!text) return;
      const msg = document.createElement("div");
      msg.className = "plugin-chat-message " + (isUser ? "user" : "assistant");
      // Handle simple markdown bold for UI
      msg.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      if (prepend) {
        messagesEl.insertBefore(msg, messagesEl.firstChild);
      } else {
        messagesEl.appendChild(msg);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    };

    const appendImage = (url, isUser, prepend = false) => {
      if (!url) return;
      const img = document.createElement("img");
      img.src = url;
      img.className = "plugin-chat-image " + (isUser ? "user" : "assistant");
      if (prepend) {
        messagesEl.insertBefore(img, messagesEl.firstChild);
      } else {
        messagesEl.appendChild(img);
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

      const productArticle = document.querySelector('article[data-product-id]');
      const productId = productArticle ? productArticle.getAttribute('data-product-id') : undefined;

      try {
        const res = await fetch(`/api/plugins/${pluginSlug}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentKey: "customer", // The plugin uses 'customer' agent
            sessionId: sessionId,
            hmacToken: hmacToken,
            turnstileToken: turnstileToken,
            message: text,
            url: window.location.href,
            title: document.title,
            productId: productId
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
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(msg => appendMessage(msg, false));
        } else if (data.text) {
          appendMessage(data.text, false);
        }
        
        if (data.images && data.images.length > 0) {
          data.images.forEach(img => appendImage(img, false));
        }
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
