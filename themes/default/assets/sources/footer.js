// JS riêng cho footer.liquid — trống mặc định.

(function setupAddressAutocomplete() {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  let activeDropdown = null;
  let activeWrapper = null;
  let timeout;

  document.addEventListener('input', (e) => {
    const input = e.target;
    // Hỗ trợ cả input[name="customerAddress"] và bất kỳ phần tử nào có class="customerAddress"
    if (!input || !input.matches || !input.matches('input[name="customerAddress"], .customerAddress')) return;

    if (!input.parentNode.classList.contains('address-autocomplete-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'address-autocomplete-wrapper';
      wrapper.style.position = 'relative';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      const dropdown = document.createElement('ul');
      dropdown.className = 'absolute z-50 w-full bg-white border border-gray-300 rounded mt-1 hidden shadow-lg max-h-60 overflow-y-auto list-none pl-0 mb-0';
      wrapper.appendChild(dropdown);
    }

    const wrapper = input.parentNode;
    const dropdown = wrapper.querySelector('ul');
    
    activeDropdown = dropdown;
    activeWrapper = wrapper;

    clearTimeout(timeout);
    const val = input.value.trim();
    if (!val) {
      dropdown.classList.add('hidden');
      return;
    }
    
    timeout = setTimeout(async () => {
      try {
        const res = await fetch('/api/address-autocomplete?input=' + encodeURIComponent(val));
        if (!res.ok) return;
        const { predictions } = await res.json();
        if (predictions && predictions.length > 0) {
          dropdown.innerHTML = predictions.map(p => 
            '<li class="px-4 py-2 hover:bg-gray-100 cursor-pointer text-sm border-b last:border-b-0">' + escapeHtml(p.description) + '</li>'
          ).join('');
          dropdown.classList.remove('hidden');

          dropdown.querySelectorAll('li').forEach((li, i) => {
            li.addEventListener('click', () => {
              input.value = predictions[i].description;
              dropdown.classList.add('hidden');
              input.dispatchEvent(new Event('input', { bubbles: true })); // Bắn event để các thư viện ngoài (nếu có) nhận diện thay đổi
            });
          });
        } else {
          dropdown.classList.add('hidden');
        }
      } catch (err) {
        console.error('Autocomplete error', err);
      }
    }, 500);
  });

  document.addEventListener('click', (e) => {
    if (activeDropdown && activeWrapper && !activeWrapper.contains(e.target)) {
      activeDropdown.classList.add('hidden');
    }
  });
})();
