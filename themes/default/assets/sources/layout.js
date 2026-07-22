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
