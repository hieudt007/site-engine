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

    const attachBtn = container.querySelector("#plugin-chat-attach");
    const fileInput = container.querySelector("#plugin-chat-file");
    const previewContainer = container.querySelector("#plugin-chat-preview");
    const previewImg = container.querySelector("#plugin-chat-preview-img");
    const previewName = container.querySelector("#plugin-chat-preview-name");
    const previewClose = container.querySelector("#plugin-chat-preview-close");

    let pendingImageFile = null;
    let historyLoaded = false;
    let nextCursor = null;
    let isLoadingHistory = false;
    const renderedIds = new Set();

    const fetchHistory = async (cursor = null, isPolling = false) => {
      if (isLoadingHistory) return;
      isLoadingHistory = true;

      let sessionId = localStorage.getItem("site_engine_chat_session") || container.getAttribute("data-session-id");
      let hmacToken = localStorage.getItem("site_engine_chat_hmac") || container.getAttribute("data-hmac");
      
      if (sessionId && hmacToken) {
        try {
          const url = `/api/customer-chat?sessionId=${encodeURIComponent(sessionId)}&hmacToken=${encodeURIComponent(hmacToken)}` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
          const res = await fetch(url);
          
          if (res.ok) {
            const data = await res.json();
            if (!isPolling) nextCursor = data.nextCursor;

            if (data.history && data.history.length > 0) {
              const oldScrollHeight = messagesEl.scrollHeight;
              
              if (cursor) {
                for (let i = data.history.length - 1; i >= 0; i--) {
                  const r = data.history[i];
                  if (!renderedIds.has(r.id)) {
                    renderedIds.add(r.id);
                    appendMessage(r.content, r.role === 'user', true, r.id);
                    if (r.images && r.images.length > 0) {
                      for (let j = r.images.length - 1; j >= 0; j--) {
                        appendImage(r.images[j], r.role === 'user', true);
                      }
                    }
                  }
                }
                messagesEl.scrollTop = messagesEl.scrollHeight - oldScrollHeight;
              } else {
                let hasNew = false;
                const localMsgs = Array.from(messagesEl.querySelectorAll('.plugin-chat-message:not([data-id]):not(.loading)'));
                data.history.forEach(r => {
                  if (!renderedIds.has(r.id)) {
                    const expectedHtml = r.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
                    const matchIdx = localMsgs.findIndex(m => 
                        m.classList.contains(r.role === 'user' ? 'user' : 'assistant') && 
                        m.innerHTML === expectedHtml
                    );
                    
                    if (matchIdx !== -1) {
                        localMsgs[matchIdx].setAttribute("data-id", r.id);
                        localMsgs.splice(matchIdx, 1);
                        renderedIds.add(r.id);
                    } else {
                        renderedIds.add(r.id);
                        hasNew = true;
                        appendMessage(r.content, r.role === 'user', false, r.id);
                        if (r.images && r.images.length > 0) {
                          r.images.forEach(img => appendImage(img, r.role === 'user'));
                        }
                    }
                  }
                });
                
                if (hasNew && !isPolling) {
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                }
              }
            }
                
                // Kiem tra xem co pause khong (khi poll data se co isPaused flag tra ve neu backend ho tro,
                // nhung backend API /chat GET hien chua tra ve isPaused, nen chi don gian la fetch message thoi)
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
    // AI khong con gui field "images" rieng nua - URL anh nam THANG trong noi dung message (xem
    // BaseAgent.ts RESPONSE_FORMAT_GUIDE). Tach URL anh ra khoi text (khong hien URL tho trong bubble
    // chat), tra ve rieng de goi appendImage() nhu cu; URL con lai (khong phai anh) boc thanh <a>.
    const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i;
    const URL_REGEX = /https?:\/\/\S+/g;
    const extractImages = (text) => {
      const images = [];
      const cleanText = text.replace(URL_REGEX, (url) => {
        const trimmed = url.replace(/[.,;:!?)]+$/, "");
        if (IMAGE_EXT_REGEX.test(trimmed)) {
          images.push(trimmed);
          return "";
        }
        return `<a href="${trimmed}" target="_blank" rel="noopener noreferrer">${trimmed}</a>`;
      });
      return { cleanText: cleanText.trim(), images };
    };

    const appendMessage = (text, isUser, prepend = false, id = null) => {
      if (!text) return;
      const { cleanText, images } = extractImages(text);
      let msg = null;
      if (cleanText) {
        msg = document.createElement("div");
        msg.className = "plugin-chat-message " + (isUser ? "user" : "assistant");
        if (id) msg.setAttribute("data-id", id);
        // Handle simple markdown bold for UI
        msg.innerHTML = cleanText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
        if (prepend) {
          messagesEl.insertBefore(msg, messagesEl.firstChild);
        } else {
          messagesEl.appendChild(msg);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
      images.forEach((url) => appendImage(url, isUser, prepend));
      return msg;
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

    const clearPreview = () => {
      pendingImageFile = null;
      if (fileInput) fileInput.value = "";
      if (previewContainer) previewContainer.classList.add("hidden");
      if (previewImg) previewImg.src = "";
    };

    const handleFileSelection = (file) => {
      if (!file || !file.type.startsWith("image/")) {
        alert("Vui lòng chọn một tệp hình ảnh hợp lệ.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert("Hình ảnh không được vượt quá 8MB.");
        return;
      }
      pendingImageFile = file;
      if (previewName) previewName.textContent = file.name;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        if (previewImg) previewImg.src = e.target.result;
        if (previewContainer) previewContainer.classList.remove("hidden");
      };
      reader.readAsDataURL(file);
    };

    if (attachBtn) {
      attachBtn.addEventListener("click", () => fileInput && fileInput.click());
    }
    
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
          handleFileSelection(e.target.files[0]);
        }
      });
    }

    if (previewClose) {
      previewClose.addEventListener("click", clearPreview);
    }

    if (input) {
      input.addEventListener("paste", (e) => {
        if (e.clipboardData && e.clipboardData.items) {
          for (const item of e.clipboardData.items) {
            if (item.type.indexOf("image") !== -1) {
              e.preventDefault();
              const file = item.getAsFile();
              handleFileSelection(file);
              break;
            }
          }
        }
      });
    }

    // Form submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text && !pendingImageFile) return;

      input.value = "";
      input.disabled = true;
      if (attachBtn) attachBtn.disabled = true;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      
      if (text) appendMessage(text, true);
      if (pendingImageFile && previewImg) appendImage(previewImg.src, true);

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
        let uploadedImages = [];
        const fileToUpload = pendingImageFile;
        clearPreview();

        if (fileToUpload) {
          const formData = new FormData();
          formData.append("file", fileToUpload);
          formData.append("sessionId", sessionId);
          formData.append("hmacToken", hmacToken);
          const upRes = await fetch(`/api/customer-chat/upload`, {
            method: "POST",
            body: formData
          });
          if (!upRes.ok) throw new Error("Lỗi upload ảnh");
          const upData = await upRes.json();
          if (upData.url) uploadedImages.push(upData.url);
        }

        const res = await fetch(`/api/customer-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentKey: "customer",
            sessionId: sessionId,
            hmacToken: hmacToken,
            turnstileToken: turnstileToken,
            message: text || "[Đã gửi một hình ảnh]",
            url: window.location.href,
            title: document.title,
            productId: productId,
            images: uploadedImages
          })
        });

        if (!res.ok) {
          loading.remove();
          const err = await res.json().catch(() => ({}));
          appendMessage("Lỗi: " + (err.error || "Không thể kết nối với CSKH"), false);

          // Reset turnstile if failed
          if (window.turnstile) {
            window.turnstile.reset();
          }
          return;
        }

        // Server tra ve SSE (routes/public/customerChat.ts) thay vi 1 JSON don - "message_delta" gop
        // dan vao bubble loading de co hieu ung go chu that (chi co khi agent CSKH bat Agent.stream=
        // true), "done" moi la ket qua cuoi cung chinh thuc (giong luong admin ai-chat-widget.liquid).
        if (!res.body) {
          loading.remove();
          appendMessage("Lỗi: Không nhận được phản hồi từ CSKH", false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop();

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            let event;
            try { event = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }

            if (event.step === "typing_start") {
              // Bat dau 1 VONG GOI AI MOI trong vong lap - chi reset buffer go chu, KHONG dong gi
              // khac (bo qua het cac step khac nhu "tool"/"narration" - CSKH chi quan tam "message"
              // that su, xem yeu cau: cac stream khac ke ca tool dang chay deu bo qua khong xu ly).
              streamedText = "";
            } else if (event.step === "message_delta") {
              // Hien chu dang go dan NHU 1 TIN NHAN THAT (bo class "loading" de tat hieu ung pulse) -
              // van la chinh bubble loading nay, chua tao tin nhan that/chua luu log, chi doi giao
              // dien - noi dung chinh thuc chi duoc luu khi co event "done".
              streamedText += event.text;
              loading.classList.remove("loading");
              loading.textContent = streamedText;
              messagesEl.scrollTop = messagesEl.scrollHeight;
            } else if (event.step === "error") {
              loading.remove();
              appendMessage("Lỗi: " + event.label, false);
              if (window.turnstile) window.turnstile.reset();
              return;
            } else if (event.step === "done") {
              const data = event.payload || {};
              const finalMsgs = (data.messages && data.messages.length > 0) ? data.messages : [];

              if (finalMsgs.length > 0 && !loading.classList.contains("loading")) {
                // Bubble nay DA hien chu that qua "message_delta" roi - GIU NGUYEN element (khong
                // xoa di tao lai tu dau du chua he ghi vao log/DB, tranh mat noi dung dang hien
                // tren man hinh), chi hoan thien lai dung format cuoi cung (tach anh/link, giong
                // appendMessage()) cho tin nhan DAU TIEN. Cac tin con lai (hiem khi > 1) van tao
                // bubble moi binh thuong.
                const { cleanText, images } = extractImages(finalMsgs[0]);
                if (cleanText) {
                  loading.innerHTML = cleanText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
                } else {
                  loading.remove();
                }
                images.forEach((url) => appendImage(url, false));
                for (let i = 1; i < finalMsgs.length; i++) appendMessage(finalMsgs[i], false);
              } else {
                loading.remove();
                // appendMessage tu tach anh (URL anh nam thang trong text) - khong con data.images rieng.
                finalMsgs.forEach(msg => appendMessage(msg, false));
              }
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          }
        }
      } catch (err) {
        loading.remove();
        appendMessage("Lỗi kết nối mạng hoặc upload thất bại.", false);
      } finally {
        input.disabled = false;
        if (attachBtn) attachBtn.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
        input.focus();
      }
    });

    // Polling 5s de cap nhat tin nhan moi
    setInterval(() => {
      if (!drawer.classList.contains("hidden") && historyLoaded && !isLoadingHistory) {
        // fetchHistory(null, true) returns the latest 20 messages, we can just call it to append new ones
        fetchHistory(null, true);
      }
    }, 5000);
  });
})();
