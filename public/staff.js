let assistedQuote = null,
  assistedBusy = false,
  roleBusy = false;
function staffMenus() {
  const manager = state.session.user.role === "AccountManager";
  if (manager) {
    $("staff-task-summary").hidden = false;
    $("staff-scope-label").textContent =
      "Périmètre : " +
      (state.session.user.country || "Pays à configurer") +
      (state.session.user.province
        ? " · " + state.session.user.province
        : " · tout le pays");
    for (const button of document.querySelectorAll(
      '[data-kind="transactions"],[data-kind="orders"]',
    ))
      button.hidden = true;
    for (const link of document.querySelectorAll(
      ".sidebar .menu-items .nav-link",
    ))
      if (
        !["/users", "/users/new", "/cards", "/registrations"].includes(
          link.getAttribute("href"),
        )
      )
        link.closest("li").hidden = true;
    for (const category of document.querySelectorAll(".sidebar .nav-category"))
      if (category.textContent.trim() === "Pilotage") category.hidden = true;
  }
  const caption = $("admin-name").nextElementSibling;
  if (caption)
    caption.textContent = manager
      ? "Gestionnaire de compte"
      : "Administration Cashpay";
}
async function setupStaffActions(user) {
  const admin = state.session.user.role === "Admin";
  $("staff-role-panel").hidden = true;
  $("assisted-card-panel").hidden = true;
  assistedQuote = null;
  $("card-consent-form").hidden = true;
  $("staff-role-open").hidden =
    !admin || !["Client", "AccountManager"].includes(user.role);
  $("assisted-card-open").hidden =
    !["Client", "PartnerB2B"].includes(user.role) ||
    String(user.status).toLowerCase() !== "active";
  if (admin && ["Client", "AccountManager"].includes(user.role)) {
    const data = await api("/api/registration/countries");
    const country = data.countries.find(
      (c) =>
        c.name.toLowerCase() === String(user.country).toLowerCase() ||
        c.code.toLowerCase() === String(user.country).toLowerCase(),
    );
    $("staff-country").value = country?.code || "";
    $("staff-province").value = user.province || "";
    $("staff-role").value = "AccountManager";
  }
}
$("staff-role-open").addEventListener("click", () => {
  $("staff-role-panel").hidden = !$("staff-role-panel").hidden;
});
$("assisted-card-open").addEventListener("click", () => {
  $("assisted-card-panel").hidden = !$("assisted-card-panel").hidden;
});
$("staff-role-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (roleBusy) return;
  roleBusy = true;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/users/" + state.userId + "/staff-role", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        role: $("staff-role").value,
        countryCode: $("staff-country").value.toUpperCase(),
        province: $("staff-province").value,
        admin_pin: $("staff-pin").value,
      }),
    });
    await loadProfile();
    $("staff-role-panel").hidden = false;
    $("staff-role-result").textContent =
      "Habilitation et périmètre enregistrés. Les droits sont revérifiés à chaque requête.";
  } catch (reason) {
    $("staff-role-result").textContent = reason.message;
  } finally {
    roleBusy = false;
    button.disabled = false;
    $("staff-pin").value = "";
  }
});
$("card-quote-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (assistedBusy) return;
  assistedBusy = true;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  $("assisted-card-result").textContent = "";
  assistedQuote = null;
  $("card-consent-form").hidden = true;
  try {
    const data = await api("/api/users/" + state.userId + "/card-quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        brand: $("assisted-card-brand").value,
        currency: $("assisted-card-currency").value,
        card_type: "physique",
      }),
    });
    assistedQuote = data.quote;
    $("assisted-card-price").textContent =
      `Tarif exact à débiter : ${data.product.price} ${data.product.currency} · ${data.product.brand.toUpperCase()} physique. Devis valable dix minutes.`;
    $("card-consent-form").hidden = false;
    $("assisted-card-consent").checked = false;
  } catch (reason) {
    $("assisted-card-result").textContent = reason.message;
  } finally {
    assistedBusy = false;
    button.disabled = false;
  }
});
for (const id of ["assisted-card-brand", "assisted-card-currency"])
  $(id).addEventListener("change", () => {
    assistedQuote = null;
    $("card-consent-form").hidden = true;
  });
$("card-consent-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (assistedBusy || !assistedQuote || !$("assisted-card-consent").checked)
    return;
  assistedBusy = true;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("/api/users/" + state.userId + "/card-orders", {
      method: "POST",
      timeoutMs: 65000,
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        quote: assistedQuote,
        consent: true,
        staff_pin: $("assisted-staff-pin").value,
        customer_pin: $("assisted-customer-pin").value,
      }),
    });
    assistedQuote = null;
    $("card-consent-form").hidden = true;
    $("assisted-card-result").textContent =
      `Commande #${data.request_id} enregistrée, paiement ${data.price} ${data.currency}, référence ${data.reference}. Statut : en attente. Aucune carte n’est déclarée attribuée ou livrée sans validation fournisseur.`;
    if (data.notifications)
      for (const [channel, status] of Object.entries(data.notifications))
        $("assisted-card-result").append(
          element(
            "p",
            channel + " : " + status,
            status === "accepted" ? "text-success" : "text-warning",
          ),
        );
    if (data.notificationAudit === false)
      $("assisted-card-result").append(
        element("p", "Suivi des notifications non journalisé.", "text-warning"),
      );
    state.kind = "cards";
    await loadActivity();
  } catch (reason) {
    $("assisted-card-result").textContent =
      reason.message +
      " Après une interruption, vérifiez les demandes existantes avant une nouvelle commande.";
  } finally {
    assistedBusy = false;
    button.disabled = false;
    $("assisted-staff-pin").value = "";
    $("assisted-customer-pin").value = "";
  }
});

$("staff-role").addEventListener("change", () => {
  $("staff-country").required = $("staff-role").value === "AccountManager";
});
