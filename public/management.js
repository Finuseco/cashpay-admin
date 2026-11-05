let managedSnapshot = null,
  clientMutationBusy = false,
  operationsPage = 0,
  operationsHasMore = false,
  operationsBusy = false;
const operationNames = {
  transactions: "Transactions",
  cards: "Commandes de cartes",
  orders: "Ventes et commandes",
  registrations: "Historique des inscriptions et interventions",
};
async function renderClientManagement(user) {
  $("client-management").hidden = true;
  $("partner-panel").hidden = true;
  $("edit-client-open").hidden = true;
  $("partner-open").hidden = true;
  $("user-certificate").href = "/users/" + user.id + "/certificate";
  $("user-certificate").hidden = !["Client", "PartnerB2B"].includes(user.role);
  if (!["Client", "PartnerB2B"].includes(user.role)) return;
  try {
    $("edit-customer-consent").hidden =
      state.session.user.role !== "AccountManager";
    managedSnapshot = await api("/api/users/" + user.id + "/manage");
    for (const field of Object.keys(managedSnapshot))
      if ($("edit-" + field))
        $("edit-" + field).value = managedSnapshot[field] || "";
    $("edit-client-open").hidden = false;
    $("partner-open").hidden =
      state.session.user.role !== "Admin" ||
      user.role !== "Client" ||
      String(user.status).toLowerCase() !== "active";
  } catch (reason) {
    $("app-status").textContent =
      "Consultation disponible. Gestion de ce compte indisponible : " +
      reason.message;
  }
}
$("edit-client-open").addEventListener("click", () => {
  $("client-management").hidden = !$("client-management").hidden;
});
$("partner-open").addEventListener("click", () => {
  $("partner-panel").hidden = !$("partner-panel").hidden;
});
$("edit-client-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (clientMutationBusy) return;
  clientMutationBusy = true;
  const submit = event.currentTarget.querySelector("button");
  submit.disabled = true;
  try {
    const changes = {};
    for (const [key, value] of new FormData(event.currentTarget))
      if ((value.trim() || null) !== (managedSnapshot[key] || null))
        changes[key] = value;
    if (!Object.keys(changes).length) {
      $("edit-client-result").textContent = "Aucune donnée modifiée.";
      return;
    }
    await api("/api/users/" + state.userId, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        changes,
        version: managedSnapshot.version,
        reason: $("edit-reason").value,
        admin_pin: $("edit-admin-pin").value,
        customer_pin: $("edit-customer-pin").value,
      }),
    });
    await loadProfile();
    $("edit-client-result").textContent =
      "Modifications enregistrées et journalisées.";
    $("client-management").hidden = false;
  } catch (reason) {
    $("edit-client-result").textContent = reason.message;
  } finally {
    clientMutationBusy = false;
    submit.disabled = false;
    $("edit-admin-pin").value = "";
    $("edit-customer-pin").value = "";
  }
});
$("partner-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (clientMutationBusy || !$("partner-confirm").checked) return;
  clientMutationBusy = true;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    await api("/api/users/" + state.userId + "/partner", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        company_name: $("partner-company").value,
        admin_pin: $("partner-pin").value,
      }),
    });
    await loadProfile();
    $("app-status").textContent =
      "Compte partenaire B2B activé et intervention enregistrée. Les identifiants sont gérés dans le portail partenaire Cashpay.";
  } catch (reason) {
    $("partner-result").textContent = reason.message;
  } finally {
    clientMutationBusy = false;
    button.disabled = false;
    $("partner-pin").value = "";
  }
});
async function loadOperations() {
  if (operationsBusy) return;
  operationsBusy = true;
  const kind = location.pathname.slice(1);
  $("operations-view").hidden = false;
  $("operations-title").textContent = operationNames[kind];
  $("operations-info").textContent = "Lecture des données…";
  try {
    const query = new URLSearchParams({
      page: String(operationsPage),
      search: $("operations-query").value,
      status: $("operations-status").value,
    });
    const data = await api("/api/operations/" + kind + "?" + query);
    operationsHasMore = data.hasMore;
    const headers =
      kind === "transactions"
        ? [
            "Date",
            "Référence",
            "Type",
            "Statut",
            "Émetteur",
            "Bénéficiaire",
            "Devise",
            "Montant",
            "Frais",
            "Fiche",
          ]
        : kind === "cards"
          ? [
              "Date",
              "Demande",
              "Titulaire",
              "ID Wallet",
              "Type",
              "Marque",
              "Statut",
              "Fiche",
            ]
          : kind === "orders"
            ? [
                "Date",
                "Référence",
                "Acheteur",
                "Statut",
                "Devise",
                "Montant",
                "Détail",
              ]
            : [
                "Date",
                "Intervention",
                "Compte",
                "ID Wallet",
                "Administrateur",
                "Action",
                "Détail / notifications",
                "Fiche / certificat",
              ];
    const head = element("tr");
    for (const text of headers) head.append(element("th", text));
    $("operations-head").replaceChildren(head);
    const userLink = (row) => {
      if (!row.user_id) return "—";
      const a = element("a", "Consulter");
      a.href = "/users/" + row.user_id;
      return a;
    };
    const rows = data.rows.map((row) => {
      if (kind === "transactions")
        return [
          date(row.created_at),
          row.reference,
          row.type_code,
          row.status,
          row.user_name,
          row.recipient_name,
          row.currency,
          decimal(row.amount, row.currency),
          row.fee === null ? "Indisponible" : decimal(row.fee, row.currency),
          userLink(row),
        ];
      if (kind === "cards")
        return [
          date(row.created_at),
          row.id,
          row.user_name,
          row.id_wallet,
          row.card_type,
          row.brand,
          row.currency,
          row.status,
          userLink(row),
        ];
      if (kind === "orders") {
        const button = element(
          "button",
          "Articles / vendeurs",
          "btn btn-outline-primary btn-sm",
        );
        button.type = "button";
        button.addEventListener("click", () => void showOrder(row.id));
        return [
          date(row.created_at),
          row.reference,
          row.user_name,
          row.status,
          row.currency,
          decimal(row.amount, row.currency),
          button,
        ];
      }
      const links = element("div");
      links.append(userLink(row));
      if (row.status === "ACCOUNT_CREATE") {
        const a = element("a", " · Certificat A4");
        a.href = "/users/" + row.user_id + "/certificate";
        links.append(a);
      }
      return [
        date(row.created_at),
        row.id,
        row.user_name,
        row.id_wallet,
        row.actor_name,
        row.status,
        row.summary,
        links,
      ];
    });
    fillRows("operations-rows", rows, headers.length);
    $("operations-info").textContent = data.available
      ? "Données réelles du registre. Consultation et recherche ; les règlements et approbations restent exécutés par leurs services Cashpay dédiés."
      : data.error;
    $("app-status").textContent = "Service : " + operationNames[kind];
    $("operations-page").textContent = "Page " + (operationsPage + 1);
  } catch (reason) {
    $("operations-info").textContent = reason.message;
  } finally {
    operationsBusy = false;
    $("operations-prev").disabled = operationsPage === 0;
    $("operations-next").disabled = !operationsHasMore;
  }
}
async function showOrder(id) {
  $("order-detail").hidden = false;
  $("order-detail-title").textContent = "Chargement de la commande…";
  $("order-detail-items").replaceChildren();
  try {
    const data = await api("/api/orders/" + id);
    $("order-detail-title").textContent =
      `Commande ${data.order.reference} — ${data.order.buyer_name}`;
    if (!data.items.available)
      $("order-detail-items").textContent = data.items.error;
    else
      for (const item of data.items.rows) {
        const p = element(
          "p",
          `${item.product_name} · quantité ${item.quantity} · vendeur ${item.seller_name || "Non renseigné"} `,
        );
        if (item.seller_id) {
          const a = element("a", "Consulter le vendeur");
          a.href = "/users/" + item.seller_id;
          p.append(a);
        }
        $("order-detail-items").append(p);
      }
    const buyer = element(
      "a",
      "Consulter l’acheteur",
      "btn btn-outline-primary",
    );
    buyer.href = "/users/" + data.order.user_id;
    $("order-detail-items").append(buyer);
    $("order-detail").scrollIntoView({ behavior: "smooth" });
  } catch (reason) {
    $("order-detail-title").textContent = reason.message;
  }
}
$("operations-search").addEventListener("submit", (event) => {
  event.preventDefault();
  operationsPage = 0;
  void loadOperations();
});
$("operations-prev").addEventListener("click", () => {
  if (!operationsBusy && operationsPage > 0) {
    operationsPage--;
    void loadOperations();
  }
});
$("operations-next").addEventListener("click", () => {
  if (!operationsBusy && operationsHasMore) {
    operationsPage++;
    void loadOperations();
  }
});
// Existing Corona scripts operate the menu. Keep ARIA and viewport state in sync.
const menuButton = document.querySelector('[data-toggle="offcanvas"]');
menuButton.setAttribute("aria-controls", "sidebar");
menuButton.setAttribute("aria-expanded", "false");
new MutationObserver(() =>
  menuButton.setAttribute(
    "aria-expanded",
    String($("sidebar").classList.contains("active")),
  ),
).observe($("sidebar"), { attributes: true, attributeFilter: ["class"] });
const desktopButton = document.querySelector('[data-toggle="minimize"]');
desktopButton.classList.add("d-none", "d-lg-block");
window.matchMedia("(min-width: 992px)").addEventListener("change", () => {
  $("sidebar").classList.remove("active");
  if (window.innerWidth < 992)
    document.body.classList.remove("sidebar-icon-only");
});

function desktopMenuState() {
  const expanded = !document.body.classList.contains("sidebar-icon-only");
  desktopButton.setAttribute("aria-expanded", String(expanded));
  desktopButton.setAttribute("aria-controls", "sidebar");
  desktopButton.setAttribute(
    "aria-label",
    expanded ? "Réduire le menu" : "Développer le menu",
  );
}
new MutationObserver(desktopMenuState).observe(document.body, {
  attributes: true,
  attributeFilter: ["class"],
});
desktopMenuState();
