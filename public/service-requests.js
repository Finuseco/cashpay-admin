function serviceControls(busy) {
  for (const id of [
    "service-kind",
    "service-status",
    "service-refresh",
    "service-prev",
    "service-next",
  ])
    document.getElementById(id).disabled = busy;
  if (!busy)
    document.getElementById("service-status").disabled =
      document.getElementById("service-kind").value !== "tv";
}
const serviceState = { page: 0, hasMore: false, busy: false, selection: null };
async function bootServiceRequests() {
  document.getElementById("service-requests-view").hidden = false;
  await loadServiceRequests();
}
async function loadServiceRequests() {
  if (serviceState.busy) return;
  serviceState.busy = true;
  serviceControls(true);
  const kind = $("service-kind").value;
  $("service-state").textContent = "Chargement…";
  $("service-status").disabled = kind !== "tv";
  try {
    const data = await api(
      `/api/service-requests/${kind}?page=${serviceState.page}&status=${encodeURIComponent($("service-status").value)}`,
    );
    serviceState.hasMore = data.hasMore || data.historyHasMore;
    fillRows(
      "service-rows",
      (kind === "tv" ? data.requests : data.claims).map((row) => {
        const actions = element("div");
        for (const [label, action] of kind === "tv" && row.status === "pending"
          ? [
              ["Activer", "activate"],
              ["Rejeter et rembourser", "reject"],
            ]
          : kind === "claims" &&
              row.status === "pending" &&
              !row.processing_status
            ? [["Autoriser le traitement", "approve"]]
            : []) {
          const button = element(
            "button",
            label,
            "btn btn-sm btn-outline-primary mr-2 mb-2",
          );
          button.type = "button";
          const icon = document.createElement("i");
          icon.className =
            "mdi mdi-" +
            (action === "reject"
              ? "close-circle-outline"
              : "check-circle-outline");
          icon.setAttribute("aria-hidden", "true");
          button.prepend(icon, document.createTextNode(" "));
          button.onclick = () => {
            serviceState.selection = { id: row.id, kind, action };
            $("service-action-title").textContent =
              label + " — demande #" + row.id;
            $("service-provider-reference").value = "";
            $("service-provider-reference").required = action === "activate";
            $("service-provider-reference").closest(".form-group").hidden =
              action !== "activate";
            $("service-pin").value = "";
            $("service-action-panel").hidden = false;
            $("service-action-panel").scrollIntoView({
              block: "nearest",
              behavior: "smooth",
            });
          };
          actions.append(button);
        }
        return [
          `#${row.id} · ${row.full_name || ""} · ${row.id_wallet || ""} · ${row.country || ""}`,
          kind === "tv"
            ? `${row.operator_name} · ${row.service_name} · ${row.amount} ${row.currency} · Décodeur ${row.smartcard_number}`
            : `${row.provider} · ${row.expected_amount} ${row.expected_currency} → ${row.receive_in_currency}`,
          `${row.status}${row.processing_status ? " / " + row.processing_status : ""}${row.agent_name ? " · " + row.agent_name + " · " + row.agent_wallet : ""}${row.payment_status ? " · Paiement " + row.payment_status : ""}`,
          actions,
        ];
      }),
      4,
    );
    $("service-history-panel").hidden = false;
    if (data.history)
      fillRows(
        "service-history-rows",
        data.history.map((row) => [
          `${date(row.created_at)} · #${row.claim_id || "—"}`,
          `${row.actor_name || ""} · ${row.actor_wallet || ""}`,
          row.action,
          typeof row.detail === "string"
            ? row.detail
            : JSON.stringify(row.detail),
        ]),
        4,
      );
    $("service-state").textContent =
      "Données actualisées à " + new Date().toLocaleTimeString("fr-FR") + ".";
  } catch (e) {
    $("service-state").textContent = e.message;
    serviceState.hasMore = false;
    fillRows("service-rows", [], 4);
    fillRows("service-history-rows", [], 4);
  } finally {
    serviceState.busy = false;
    serviceControls(false);
    $("service-prev").disabled = serviceState.page === 0;
    $("service-next").disabled = !serviceState.hasMore;
  }
}
for (const id of ["service-kind", "service-status"])
  document.getElementById(id).addEventListener("change", () => {
    serviceState.page = 0;
    serviceState.selection = null;
    $("service-action-panel").hidden = true;
    void loadServiceRequests();
  });
document.getElementById("service-refresh").onclick = () =>
  void loadServiceRequests();
document.getElementById("service-prev").onclick = () => {
  if (serviceState.page > 0) {
    serviceState.page--;
    void loadServiceRequests();
  }
};
document.getElementById("service-next").onclick = () => {
  serviceState.page++;
  void loadServiceRequests();
};
document.getElementById("service-action-cancel").onclick = () => {
  serviceState.selection = null;
  $("service-action-panel").hidden = true;
  $("service-pin").value = "";
};
document
  .getElementById("service-action-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (serviceState.busy || !serviceState.selection) return;
    const selected = serviceState.selection;
    serviceState.busy = true;
    serviceControls(true);
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/service-requests/" + selected.kind, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": state.session.csrf,
        },
        body: JSON.stringify({
          ...selected,
          pin: $("service-pin").value,
          providerReference: $("service-provider-reference").value,
        }),
      });
      $("service-action-panel").hidden = true;
      serviceState.selection = null;
      serviceState.busy = false;
      await loadServiceRequests();
    } catch (e) {
      $("service-state").textContent = e.message;
    } finally {
      $("service-pin").value = "";
      serviceState.busy = false;
      serviceControls(false);
      $("service-prev").disabled = serviceState.page === 0;
      $("service-next").disabled = !serviceState.hasMore;
      button.disabled = false;
    }
  });
