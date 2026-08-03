(function () {
  const form = document.getElementById("unlock-form");
  const errorBox = document.getElementById("unlock-error");
  const passwordInput = document.getElementById("password");
  
  // UI Elements for loading state
  const submitBtn = document.getElementById("unlock-submit");
  const submitText = document.getElementById("submit-text");
  const submitSpinner = document.getElementById("submit-spinner");

  if (!form || !errorBox || !passwordInput) return;

  const setLoadingState = (isLoading) => {
    if (!submitBtn || !submitText || !submitSpinner) return;
    
    if (isLoading) {
      submitBtn.disabled = true;
      submitBtn.classList.add("opacity-80", "cursor-not-allowed");
      submitText.textContent = "Đang xác thực...";
      submitSpinner.classList.remove("hidden");
    } else {
      submitBtn.disabled = false;
      submitBtn.classList.remove("opacity-80", "cursor-not-allowed");
      submitText.textContent = "Mở khóa bài viết";
      submitSpinner.classList.add("hidden");
    }
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.classList.add("hidden");
    setLoadingState(true);

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
        setLoadingState(false);
        passwordInput.value = '';
        passwordInput.focus();
        return;
      }

      window.location.reload();
    } catch (error) {
      errorBox.textContent = "Đã xảy ra lỗi kết nối. Vui lòng thử lại sau.";
      errorBox.classList.remove("hidden");
      setLoadingState(false);
    }
  });
})();