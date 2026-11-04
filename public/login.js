const form = document.getElementById("login-form"),
  button = document.getElementById("login-submit"),
  error = document.getElementById("login-error");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  error.textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.email.value,
        password: form.password.value,
        otp: form.otp.value,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Connexion impossible.");
    form.password.value = "";
    location.replace("/dashboard");
  } catch (reason) {
    error.textContent =
      reason.name === "TimeoutError"
        ? "La connexion a pris trop de temps. Réessayez."
        : reason.message;
  } finally {
    button.disabled = false;
  }
});
