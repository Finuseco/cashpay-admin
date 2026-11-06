const $ = (id) => document.getElementById(id);
let state = { step: "email" },
  busy = false,
  email = "",
  timer;
async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.error || "Connexion impossible."), {
      status: response.status,
      retryAfter: Number(response.headers.get("retry-after") || 0),
    });
  return data;
}
function controls() {
  document.getElementById("login-progress").hidden = !busy;
  for (const form of document.querySelectorAll("form"))
    form.setAttribute("aria-busy", String(busy));
  document.querySelectorAll("form button,form input").forEach((node) => {
    node.disabled = busy;
  });
  $("change-email").disabled = busy;
  updateResend();
}
function updateResend() {
  const seconds = Math.max(
    0,
    Math.ceil(((state.resendAt || 0) - Date.now()) / 1000),
  );
  $("resend").disabled = busy || seconds > 0;
  $("resend").replaceChildren(
    Object.assign(document.createElement("i"), {
      className: "mdi mdi-refresh",
    }),
    document.createTextNode(
      seconds > 0 ? ` Renvoyer dans ${seconds} s` : " Renvoyer le code",
    ),
  );
}
function render(next) {
  state = next;
  if (state.step === "authenticated") {
    location.replace(state.landing || "/dashboard");
    return;
  }
  for (const step of ["email", "otp", "pin"]) {
    $(step + "-form").hidden = state.step !== step;
    $("step-" + step).classList.toggle("active", state.step === step);
    $("step-" + step).setAttribute(
      "aria-current",
      state.step === step ? "step" : "false",
    );
  }
  $("change-email").hidden = state.step === "email";
  $("retry-status").hidden = true;
  $("login-info").textContent =
    state.step === "email"
      ? "Saisissez l’ID Wallet ou l’adresse e-mail de votre compte professionnel."
      : state.step === "otp"
        ? `Un code a été envoyé à ${state.destination}. Il est valable dix minutes.`
        : "Code e-mail vérifié. Saisissez maintenant votre PIN existant.";
  if (state.step === "email") {
    $("otp").value = "";
    $("pin").value = "";
  }
  controls();
  requestAnimationFrame(() =>
    $(state.step === "email" ? "email" : state.step).focus(),
  );
}
async function status() {
  const value = await api("/api/auth/status");
  render(value);
  return value;
}
async function run(action) {
  if (busy) return;
  busy = true;
  controls();
  $("login-error").textContent = "";
  try {
    await action();
  } catch (reason) {
    $("login-error").textContent =
      reason.name === "TimeoutError"
        ? "La vérification a pris trop de temps. Réessayez."
        : reason.message;
    if ([409, 410, 429].includes(reason.status)) {
      try {
        await status();
      } catch {}
    }
  } finally {
    busy = false;
    controls();
  }
}
$("email-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    email = $("email").value.toLowerCase().trim();
    const value = await api("/api/auth/email", { identifier: email });
    $("otp").value = "";
    render(value);
  });
});
$("otp-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const value = await api("/api/auth/otp", { otp: $("otp").value });
    $("otp").value = "";
    render(value);
  });
});
$("otp").addEventListener("input", () => {
  $("otp").value = $("otp").value.replace(/\D/g, "").slice(0, 6);
  if ($("otp").value.length === 6 && !busy) $("otp-form").requestSubmit();
});
$("pin-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const result = await api("/api/auth/pin", { pin: $("pin").value });
    $("pin").value = "";
    location.replace(result.landing || "/dashboard");
  });
});
$("resend").addEventListener("click", () => {
  void run(async () => {
    const value = await api("/api/auth/email", { identifier: email });
    $("otp").value = "";
    render(value);
  });
});
$("change-email").addEventListener("click", () => {
  void run(async () => {
    render(await api("/api/auth/reset", {}));
    $("otp").value = "";
    $("pin").value = "";
  });
});
$("retry-status").addEventListener("click", () => {
  void run(async () => {
    await status();
  });
});
timer = setInterval(updateResend, 1000);
window.addEventListener("pagehide", () => clearInterval(timer));
void run(async () => {
  try {
    await status();
  } catch (reason) {
    $("retry-status").hidden = false;
    throw reason;
  }
});
