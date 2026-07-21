document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById("unlock-form");
  const errorBox = document.getElementById("unlock-error");

  if (form && errorBox) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.classList.add("hidden");
      
      const passwordInput = document.getElementById("password");
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn.innerHTML;

      // Loading state
      submitBtn.innerHTML = '<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
      submitBtn.disabled = true;

      try {
        const res = await fetch(window.location.pathname + "/unlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: passwordInput.value }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          errorBox.textContent = typeof body.error === "string" ? body.error : "Mật khẩu không chính xác. Vui lòng thử lại.";
          errorBox.classList.remove("hidden");
          
          // Reset button
          submitBtn.innerHTML = originalBtnText;
          submitBtn.disabled = false;
          passwordInput.value = '';
          passwordInput.focus();
          return;
        }

        window.location.reload();
      } catch (error) {
        errorBox.textContent = "Đã xảy ra lỗi kết nối.";
        errorBox.classList.remove("hidden");
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
      }
    });
  }
});