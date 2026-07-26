
(function() {
  const btn = document.getElementById('ai-chat-button');
  const win = document.getElementById('ai-chat-window');
  const close = document.getElementById('ai-chat-close');
  const input = document.getElementById('ai-chat-input');
  const send = document.getElementById('ai-chat-send');
  const messagesDiv = document.getElementById('ai-chat-messages');
  
  const imgInput = document.getElementById('ai-chat-image-input');
  const imgBtn = document.getElementById('ai-chat-image-btn');
  const imgPreviewContainer = document.getElementById('ai-chat-image-preview-container');
  const imgPreviewThumb = document.getElementById('ai-chat-image-preview-thumb');
  const imgRemove = document.getElementById('ai-chat-image-remove');
  
  let historyLoaded = false;
  let loadingOlder = false;
  let historyLoading = false;
  let hasMoreHistory = false;
  let nextBeforeId = null;
  let isAiLoading = false;
  let pendingImageUrl = null;
  let entityId = null;
  const pathMatch = window.location.pathname.match(/^\/admin\/(posts|pages|products|settings\/theme)\/([a-zA-Z0-9-_]+)/);
  if (pathMatch) {
    const type = pathMatch[1].replace("/", "_");
    const id = pathMatch[2];
    if (id === 'new') {
      const draftKey = `ai_draft_${type}`;
      let draftId = sessionStorage.getItem(draftKey);
      if (!draftId) {
        draftId = `draft_${Math.random().toString(36).substring(2, 11)}`;
        sessionStorage.setItem(draftKey, draftId);
      }
      entityId = draftId;
    } else {
      entityId = id;
      const draftKey = `ai_draft_${type}`;
      const draftId = sessionStorage.getItem(draftKey);
      if (draftId) {
        fetch('/admin/api/ai-chat/link-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftId, newId: id })
        }).then(() => {
          sessionStorage.removeItem(draftKey);
        }).catch(console.error);
      }
    }
  }

  
  let aiTooltipTimeout = null;
  let tooltipHidden = false;

  btn.addEventListener('click', () => {
    win.classList.add('open');
    if (!historyLoaded) {
      loadInitialHistory();
    }
    
    // An tooltip ngay neu mo chat
    const tooltip = document.getElementById('ai-chat-tooltip');
    if (tooltip) {
      tooltip.classList.remove('show');
      tooltipHidden = true;
    }
  });

  // Chỉ hiện tooltip 1 lần trong phiên làm việc
  const isContentPage = window.location.pathname.match(/^\/admin\/(posts|pages|products)\/(new|.+)/);
  const hasSeenTooltip = sessionStorage.getItem('ai_tooltip_seen');
  
  if (!hasSeenTooltip) {
    setTimeout(() => {
      if (tooltipHidden || win.classList.contains('open')) return;
      const tooltip = document.getElementById('ai-chat-tooltip');
      if (tooltip) {
        tooltip.textContent = isContentPage 
          ? "Cần viết nội dung? Mở AI ngay!" 
          : "Cần hỗ trợ? Hỏi ngay AI!";
          
        tooltip.classList.add('show');
        sessionStorage.setItem('ai_tooltip_seen', 'true');
        
        // An sau 5s
        aiTooltipTimeout = setTimeout(() => {
          tooltip.classList.remove('show');
          tooltipHidden = true;
        }, 5000);
      }
    }, 3000);
  }
  
  close.addEventListener('click', () => {
    win.classList.remove('open');
  });

  function escapeHtml(unsafe) {
    return (unsafe||'').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function renderMessage(role, content, meta, imageUrl) {
    const container = document.createElement('div');
    container.className = `ai-msg-container ${role === 'user' ? 'user' : 'bot'}`;
    
    let html = '';
    if (meta) {
      html += `<div class="ai-msg-meta">${escapeHtml(meta)}</div>`;
    }
    
    let imageHtml = '';
    if (imageUrl) {
      imageHtml = `<img src="${escapeHtml(imageUrl)}" style="display:block;max-width:160px;border-radius:6px;margin-bottom:6px;">`;
    }
    
    html += `<div class="ai-msg-bubble ${role === 'user' ? 'ai-msg-user' : 'ai-msg-bot'}">${imageHtml}${escapeHtml(content)}</div>`;
    
    container.innerHTML = html;
    return container;
  }
  
  function renderHistoryItems(items, appendAtEnd = false) {
    const frag = document.createDocumentFragment();
    items.forEach(item => {
      // User message
      const meta = item.created_at ? new Date(item.created_at).toLocaleString('vi-VN') : '';
      frag.appendChild(renderMessage('user', item.user_message, meta, item.image_url));
      
      // Bot response
      const botContent = item.assistant_response || (item.error_message ? `Lỗi: ${item.error_message}` : null);
      if (botContent) {
        frag.appendChild(renderMessage('bot', botContent, item.status === 'success' ? '' : item.status));
      }
    });

    if (appendAtEnd) {
      messagesDiv.appendChild(frag);
    } else {
      messagesDiv.insertBefore(frag, messagesDiv.firstChild);
    }
  }

  function showEmptyState() {
    if (messagesDiv.children.length === 0) {
      messagesDiv.innerHTML = '<div class="ai-chat-empty">Nhập câu hỏi để gọi Assistant Agent.</div>';
    }
  }

  function clearEmptyState() {
    const empty = messagesDiv.querySelector('.ai-chat-empty');
    if (empty) empty.remove();
  }

  async function loadInitialHistory() {
    historyLoaded = true;
    historyLoading = true;
    messagesDiv.innerHTML = '<div class="ai-chat-loading"><svg class="lucide-loader-circle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Đang tải 15 đoạn chat gần nhất...</div>';
    
    try {
      const res = await fetch('/admin/api/ai-chat/history' + (entityId ? '?entityId=' + entityId : ''));
      if (!res.ok) throw new Error();
      const data = await res.json();
      
      messagesDiv.innerHTML = '';
      if (data.items && data.items.length > 0) {
        // Items API should return descending by ID, but we want to render oldest first on screen (bottom is newest)
        // So we reverse them before rendering
        renderHistoryItems(data.items.slice().reverse(), true);
        hasMoreHistory = data.has_more;
        nextBeforeId = data.next_before_id;
      }
      showEmptyState();
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } catch (err) {
      messagesDiv.innerHTML = '<div class="ai-chat-error">Không tải được lịch sử chat gần nhất.</div>';
    } finally {
      historyLoading = false;
    }
  }
  
  async function loadOlderHistory() {
    if (loadingOlder || historyLoading || !hasMoreHistory || !nextBeforeId) return;
    
    loadingOlder = true;
    const prevHeight = messagesDiv.scrollHeight;
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'ai-chat-loading';
    loadingDiv.innerHTML = '<svg class="lucide-loader-circle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Đang tải lịch sử cũ hơn...';
    messagesDiv.insertBefore(loadingDiv, messagesDiv.firstChild);

    try {
      const res = await fetch('/admin/api/ai-chat/history?before_id=' + nextBeforeId + (entityId ? '&entityId=' + entityId : ''));
      if (res.ok) {
        const data = await res.json();
        loadingDiv.remove();
        if (data.items && data.items.length > 0) {
          renderHistoryItems(data.items.slice().reverse(), false);
          hasMoreHistory = data.has_more;
          nextBeforeId = data.next_before_id;
        }
        messagesDiv.scrollTop = messagesDiv.scrollHeight - prevHeight;
      }
    } finally {
      if (loadingDiv.parentNode) loadingDiv.remove();
      loadingOlder = false;
    }
  }

  messagesDiv.addEventListener('scroll', () => {
    if (messagesDiv.scrollTop < 24) {
      loadOlderHistory();
    }
  });
  
  function clearPendingImage() {
    pendingImageUrl = null;
    imgInput.value = "";
    imgPreviewContainer.style.display = "none";
    imgBtn.style.display = "flex";
  }

  imgBtn.addEventListener('click', () => imgInput.click());
  imgRemove.addEventListener('click', clearPendingImage);

  async function handleImageUpload(file) {
    if (!file) return;
    imgBtn.disabled = true;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/admin/api/ai-chat/upload", { method: "POST", body: formData });
      if (!res.ok) {
        alert("Tải ảnh lên thất bại");
        imgInput.value = "";
        return;
      }
      const { url } = await res.json();
      pendingImageUrl = window.location.origin + url;
      imgPreviewThumb.src = url;
      imgBtn.style.display = "none";
      imgPreviewContainer.style.display = "block";
    } catch (e) {
      alert("Lỗi tải ảnh");
    } finally {
      imgBtn.disabled = false;
    }
  }

  imgInput.addEventListener('change', () => {
    handleImageUpload(imgInput.files[0]);
  });

  input.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let index in items) {
      const item = items[index];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        handleImageUpload(blob);
        break;
      }
    }
  });

  async function sendMessage(hiddenText = null, hiddenPayload = null) {
    const text = hiddenText || input.value.trim();
    if (!text && !hiddenPayload) return;
    if (isAiLoading && !hiddenPayload) return;
    
    if (!hiddenPayload) {
      const sentImageUrl = pendingImageUrl;
      clearEmptyState();
      messagesDiv.appendChild(renderMessage('user', text, '', sentImageUrl));
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      
      input.value = '';
      clearPendingImage();
      isAiLoading = true;
      
      const loadingDiv = document.createElement('div');
      loadingDiv.id = 'ai-loading-indicator';
      loadingDiv.className = 'ai-chat-loading';
      loadingDiv.innerHTML = '<svg class="lucide-loader-circle" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> <span>AI đang trả lời...</span>';
      messagesDiv.appendChild(loadingDiv);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
    
    try {
      let payload;
      if (hiddenPayload) {
        payload = hiddenPayload;
      } else {
        const isContentEditPage = window.location.pathname.match(/^\/admin\/(posts|pages|products)\/(new|.+)/);
        let formElements = [];
        
        if (isContentEditPage) {
          formElements = Array.from(document.querySelectorAll('input, textarea, select'))
            .map(el => el.id)
            .filter(id => id && !id.startsWith('ai-') && id !== 'flash' && id !== 'sidebar-toggle');
          if (document.getElementById('faq-rows')) {
            formElements.push('faq');
          }
        }

        payload = { 
          message: text,
          pageTitle: document.title,
          pageUrl: window.location.href,
          availableFields: formElements,
          layoutMode: document.getElementById('layoutMode') ? document.getElementById('layoutMode').value : null,
          entityId: entityId
        };
        if (pendingImageUrl) payload.imageUrl = pendingImageUrl;
      }

      const res = await fetch('/admin/api/ai-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const loadingEl = document.getElementById('ai-loading-indicator');
      
      if (!res.ok || !res.body) {
        if (loadingEl) loadingEl.remove();
        messagesDiv.appendChild(renderMessage('bot', "Lỗi: Không thể gọi AI.", 'error'));
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        isAiLoading = false;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch(e) { continue; }

          if (event.step === "thinking" || event.step === "tool") {
             if (loadingEl) loadingEl.querySelector('span').textContent = event.label;
          } else if (event.step === "error") {
             if (loadingEl) loadingEl.remove();
             messagesDiv.appendChild(renderMessage('bot', event.label, 'error'));
             messagesDiv.scrollTop = messagesDiv.scrollHeight;
             isAiLoading = false;
             return;
          } else if (event.step === "tool_request") {
             // Handle request_fields recursively
             const data = event.payload;
             if (loadingEl) {
               loadingEl.querySelector('span').textContent = data.message || "Đang thu thập dữ liệu...";
             }
             
             // Thu thập dữ liệu form
             const toolData = {};
             if (Array.isArray(data.fields)) {
               data.fields.forEach(fieldId => {
                 const el = document.getElementById(fieldId);
                 if (el) {
                   toolData[fieldId] = el.value !== undefined ? el.value : el.innerText;
                 } else if (fieldId === 'faq') {
                   const faqRows = document.getElementById('faq-rows');
                   if (faqRows) {
                     const faqs = [...faqRows.querySelectorAll('.faq-row')].map(row => ({
                       question: row.querySelector('.faq-q').value.trim(),
                       answer: row.querySelector('.faq-a').value.trim()
                     }));
                     toolData['faq'] = JSON.stringify(faqs);
                   }
                 }
               });
             }
             
             if (data.searchResults) toolData.searchResults = data.searchResults;
             
             const secondPayload = {
               message: payload.originalMessage || payload.message,
               isToolResponse: true,
               toolData: toolData,
               originalMessage: payload.originalMessage || payload.message,
               nextAgent: data.nextAgent || "content",
               imageUrl: payload.imageUrl,
               entityId: entityId,
               historyId: data.historyId,
               availableFields: payload.availableFields
             };
             return sendMessage(null, secondPayload);
          } else if (event.step === "done") {
             const data = event.payload || {};
             
             if (data.action === "generate_image") {
               if (loadingEl) loadingEl.querySelector('span').textContent = data.message || "Đang tạo ảnh...";
               try {
                 const imgRes = await fetch('/admin/api/ai-chat/generate-image', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ prompt: data.prompt, key: "image", historyId: data.historyId })
                 });
                 const imgData = await imgRes.json();
                 if (!imgRes.ok) throw new Error(imgData.message);
                 if (loadingEl) loadingEl.remove();
                 const markdownImg = `![Tạo ảnh](${imgData.url})\n\n[Link ảnh](${imgData.url})`;
                 messagesDiv.appendChild(renderMessage('bot', markdownImg));
               } catch (e) {
                 if (loadingEl) loadingEl.remove();
                 messagesDiv.appendChild(renderMessage('bot', "Lỗi tạo ảnh: " + e.message, 'error'));
               }
               messagesDiv.scrollTop = messagesDiv.scrollHeight;
               isAiLoading = false;
               return;
             } 
             
             if (data.action === "webfetch" || data.action === "websearch") {
               if (loadingEl) loadingEl.querySelector('span').textContent = data.message || "Đang lấy dữ liệu...";
               try {
                 const endpoint = data.action === "webfetch" ? '/admin/api/ai-chat/webfetch' : '/admin/api/ai-chat/websearch';
                 const bodyData = data.action === "webfetch" ? { url: data.url } : { query: data.query };
                 const toolRes = await fetch(endpoint, {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify(bodyData)
                 });
                 const toolDataJson = await toolRes.json();
                 if (!toolRes.ok) throw new Error(toolDataJson.message);
                 
                 const secondPayload = {
                   message: payload.originalMessage || payload.message,
                   isToolResponse: true,
                   toolData: { [data.action]: toolDataJson.result },
                   originalMessage: payload.originalMessage || payload.message,
                   nextAgent: window.location.pathname.match(/^\/admin\/(posts|pages|products)\/(new|.+)/) ? "content" : "chat",
                   imageUrl: payload.imageUrl,
                   entityId: entityId,
                   historyId: data.historyId,
                   availableFields: payload.availableFields
                 };
                 return sendMessage(null, secondPayload);
               } catch (e) {
                 if (loadingEl) loadingEl.remove();
                 messagesDiv.appendChild(renderMessage('bot', "Lỗi dữ liệu web: " + e.message, 'error'));
                 messagesDiv.scrollTop = messagesDiv.scrollHeight;
                 isAiLoading = false;
                 return;
               }
             }
              
             if (data.action === "fill_form") {
               if (loadingEl) loadingEl.remove();
               
               // Cập nhật DOM
               if (data.data && typeof data.data === 'object') {
                 for (const [key, val] of Object.entries(data.data)) {
                   const el = document.getElementById(key);
                   if (el) {
                     if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
                       el.value = val;
                       if (el.parentNode && el.parentNode.classList.contains('rich-editor-wrapper')) {
                         const editorBody = el.parentNode.querySelector('.rich-editor-body');
                         if (editorBody) {
                           editorBody.innerHTML = val;
                           editorBody.dispatchEvent(new Event('input', { bubbles: true }));
                         }
                       }
                       el.dispatchEvent(new Event('change', { bubbles: true }));
                     } else {
                       el.innerHTML = val;
                     }
                   } else if (key === 'faq') {
                     const faqRows = document.getElementById('faq-rows');
                     if (faqRows) {
                       let parsedVal = val;
                       if (typeof val === 'string') {
                         try { parsedVal = JSON.parse(val); } catch(e) { parsedVal = []; }
                       }
                       
                       if (Array.isArray(parsedVal)) {
                         faqRows.innerHTML = '';
                         parsedVal.forEach(item => {
                           if (typeof window.appendFaqRow === 'function') {
                             window.appendFaqRow(item.question, item.answer);
                           } else {
                             faqRows.insertAdjacentHTML('beforeend', `<div class="faq-row" style="display:flex;gap:0.5rem;margin-bottom:0.5rem;"><input type="text" class="input faq-q" value="${escapeHtml(item.question)}" style="flex:1;"><input type="text" class="input faq-a" value="${escapeHtml(item.answer)}" style="flex:2;"><button type="button" class="btn btn-danger btn-icon remove-faq-btn" tabindex="-1">✕</button></div>`);
                           }
                         });
                         faqRows.dispatchEvent(new Event('change', { bubbles: true }));
                       }
                     }
                   } else if (key === 'keyword') {
                     if (typeof window.addTag === 'function') {
                       const tags = val.split(',').map(s => s.trim()).filter(Boolean);
                       tags.forEach(t => window.addTag(t));
                     }
                   }
                 }
                 messagesDiv.appendChild(renderMessage('bot', data.message || "Đã điền dữ liệu vào form."));
               } else {
                 messagesDiv.appendChild(renderMessage('bot', "Không có dữ liệu để điền.", "error"));
               }
               messagesDiv.scrollTop = messagesDiv.scrollHeight;
               isAiLoading = false;
               return;
             } 
             
             // Mặc định là action: "chat"
             if (loadingEl) loadingEl.remove();
             messagesDiv.appendChild(renderMessage('bot', data.message || data.reply || "Đã xử lý xong."));
             messagesDiv.scrollTop = messagesDiv.scrollHeight;
             isAiLoading = false;
             return;
          }
        }
      }
    } catch (e) {
      const loadingEl = document.getElementById('ai-loading-indicator');
      if (loadingEl) loadingEl.remove();
      messagesDiv.appendChild(renderMessage('bot', "Lỗi kết nối: " + e.message, 'error'));
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      isAiLoading = false;
    }
  }
  
  send.addEventListener('click', () => sendMessage());
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
})();
