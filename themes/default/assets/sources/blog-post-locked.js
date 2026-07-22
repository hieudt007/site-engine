(function () {
  const form = document.getElementById("unlock-form");
  const errorBox = document.getElementById("unlock-error");
  const passwordInput = document.getElementById("password");
  if (!form || !errorBox || !passwordInput) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.classList.add("hidden");

    const res = await fetch(window.location.pathname + "/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorBox.textContent = typeof body.error === "string" ? body.error : "Sai mật khẩu";
      errorBox.classList.remove("hidden");
      return;
    }

    window.location.reload();
  });
})();
