const pricingState = {
  kind: null,
  catalog: null,
  page: 0,
  hasMore: false,
  busy: false,
  current: null,
  mode: "create",
  historyPage: 0,
  historyMore: false,
};
const pricingCountryName = (code) =>
  pricingState.catalog?.countries.find((c) => c.code === code)?.name || code;
function pricingTier(tier = { min: "0", max: "0", fee: "0" }) {
  const row = element("div", null, "row border-bottom mb-3 pb-3");
  row.classList.add("pricing-tier");
  let legacy = "";
  let fee = tier.fee;
  if (fee === null || fee === undefined) {
    const flat = Number(tier.flat || 0),
      percent = Number(tier.percent || 0);
    if (flat && percent) {
      fee = "";
      legacy =
        "Ancien format mixte : choisissez explicitement un tarif compatible avant d’enregistrer.";
    } else if (
      (tier.flat !== undefined && tier.flat !== null) ||
      (tier.percent !== undefined && tier.percent !== null)
    ) {
      fee = percent ? String(tier.percent) + "%" : String(tier.flat || 0);
      legacy =
        "Ancien format : l’enregistrement convertira ce palier au format commun.";
    } else {
      fee = "";
      legacy = "Tarif manquant : renseignez ce palier.";
    }
  }
  for (const [name, label, value] of [
    ["min", "Minimum", tier.min ?? ""],
    ["max", "Maximum (0 = sans plafond)", tier.max ?? ""],
    ["value", "Valeur du frais", String(fee).replace(/%$/, "")],
  ]) {
    const group = element("div", null, "col-md-3 form-group"),
      input = element("input", null, "form-control"),
      caption = element("label", label);
    input.dataset.field = name;
    input.value = value;
    input.required = true;
    input.inputMode = "decimal";
    input.setAttribute("aria-label", label);
    group.append(caption, input);
    row.append(group);
  }
  const group = element("div", null, "col-md-3 form-group"),
    unit = element("select", null, "form-control");
  unit.dataset.field = "unit";
  unit.setAttribute("aria-label", "Unité du frais");
  unit.add(new Option("Montant fixe", "fixed"));
  unit.add(new Option("Pourcentage (%)", "percent"));
  unit.value = String(fee).endsWith("%") ? "percent" : "fixed";
  const remove = element(
    "button",
    "Retirer",
    "btn btn-outline-danger btn-sm mt-2",
  );
  remove.type = "button";
  remove.addEventListener("click", () => row.remove());
  group.append(element("label", "Unité"), unit, remove);
  row.append(group);
  if (legacy) row.append(element("p", legacy, "text-warning col-12"));
  $("pricing-tiers").append(row);
}
function pricingPolicy() {
  const code = $("pricing-type").value.trim().toUpperCase(),
    cur = $("pricing-currency").value.trim().toUpperCase(),
    catalog = pricingState.catalog;
  if (!catalog) return;
  const embedded = /^(?:BUY_CARDS|WD_ATM)_(USD|EUR|CDF)(?:_|$)/.exec(code);
  if (
    pricingState.kind === "fees" &&
    pricingState.mode === "create" &&
    embedded
  )
    $("pricing-currency").value = embedded[1];
  if (pricingState.kind === "fees" && pricingState.mode === "create")
    $("pricing-currency").disabled = Boolean(embedded);
  const globalOnly =
    catalog.policy.globalTypes.includes(code) ||
    (code === "TICKET_BUY" && ["USD", "EUR"].includes(cur));
  if (
    pricingState.kind === "fees" &&
    pricingState.mode === "create" &&
    globalOnly
  )
    $("pricing-country").value = "GBL";
  const known = catalog.types.find((t) => t.code === code);
  $("pricing-policy").textContent =
    pricingState.kind === "rates"
      ? "Sens explicite : 1 " +
        ($("pricing-from").value || "devise de départ") +
        " = " +
        ($("pricing-rate").value || "taux") +
        " " +
        ($("pricing-to").value || "devise d’arrivée") +
        ". Le sens inverse reste une règle séparée."
      : (globalOnly
          ? "Ce code est appliqué uniquement au niveau Global (GBL). "
          : "Barème du pays sélectionné, puis repli global selon le service. ") +
        (catalog.policy.notes[code] || "") +
        (!known?.recognized
          ? " Nouveau code : le service métier doit utiliser ce code pour le facturer."
          : "");
  $("pricing-country").disabled =
    pricingState.mode === "update" ||
    (pricingState.kind === "fees" && globalOnly);
  $("pricing-country-code").textContent =
    "Code enregistré : " + $("pricing-country").value;
}
function pricingEditor(row = null, duplicate = false) {
  pricingState.current = row;
  pricingState.mode = row && !duplicate ? "update" : "create";
  $("pricing-editor").hidden = false;
  $("pricing-result").textContent = "";
  $("pricing-form").reset();
  $("pricing-editor-title").textContent =
    pricingState.mode === "create" ? "Ajouter une règle" : "Modifier la règle";
  const isFee = pricingState.kind === "fees";
  document.querySelectorAll(".pricing-fee-only").forEach((node) => {
    node.hidden = !isFee;
    for (const input of node.querySelectorAll("input,select"))
      input.disabled = !isFee;
  });
  document.querySelectorAll(".pricing-rate-only").forEach((node) => {
    node.hidden = isFee;
    for (const input of node.querySelectorAll("input")) input.disabled = isFee;
  });
  const country =
    row?.country_code || $("pricing-filter-country").value || "GBL";
  $("pricing-country").disabled = false;
  $("pricing-country").value = country;
  const local =
    pricingState.catalog.countries.find((c) => c.code === country)
      ?.currency_code || "USD";
  $("pricing-type").value = row?.transaction_type || "";
  $("pricing-currency").value = row?.currency || local;
  $("pricing-active").checked = row?.is_active ?? true;
  $("pricing-from").value = row?.from_currency || "USD";
  $("pricing-to").value = row?.to_currency || (local === "USD" ? "EUR" : local);
  $("pricing-rate").value = row?.rate || "";
  for (const id of [
    "pricing-type",
    "pricing-currency",
    "pricing-from",
    "pricing-to",
  ])
    $(id).disabled =
      pricingState.mode === "update" ||
      (isFee
        ? id === "pricing-from" || id === "pricing-to"
        : id === "pricing-type" || id === "pricing-currency");
  $("pricing-tiers").replaceChildren();
  if (isFee) {
    const items = row?.editor_tiers;
    if (items?.length) for (const tier of items) pricingTier(tier);
    else pricingTier(row ? { min: "", max: "", fee: "" } : undefined);
    $("pricing-preview-country").value = country;
    $("pricing-preview-type").value = row?.transaction_type || "";
    $("pricing-preview-currency").value = row?.currency || local;
  }
  pricingPolicy();
  $("pricing-editor").scrollIntoView({ behavior: "smooth" });
}
async function pricingHistoryLoad() {
  try {
    const data = await api(
      "/api/pricing/history?page=" + pricingState.historyPage,
    );
    pricingState.historyMore = data.hasMore;
    fillRows(
      "pricing-history-rows",
      data.rows.map((row) => [
        date(row.created_at),
        row.actor_name,
        row.action_type,
        row.country_code,
        row.code,
        row.reason,
      ]),
      6,
    );
    $("pricing-history-page").textContent =
      "Page " + (pricingState.historyPage + 1);
  } catch (error) {
    fillRows("pricing-history-rows", [[error.message]], 6);
  } finally {
    $("pricing-history-prev").disabled = pricingState.historyPage === 0;
    $("pricing-history-next").disabled = !pricingState.historyMore;
  }
}
async function pricingLoad() {
  if (pricingState.busy) return;
  pricingState.busy = true;
  $("pricing-status").textContent = "Chargement des règles…";
  try {
    const query = new URLSearchParams({
      country_code: $("pricing-filter-country").value,
      search: $("pricing-search").value,
      page: String(pricingState.page),
      active: $("pricing-filter-active").value,
    });
    const data = await api("/api/pricing/" + pricingState.kind + "?" + query);
    pricingState.hasMore = data.hasMore;
    const headers =
      pricingState.kind === "fees"
        ? [
            "Pays / code",
            "Code du frais",
            "Devise",
            "Paliers enregistrés",
            "État",
            "Actions",
          ]
        : ["Pays / code", "De", "Vers", "Taux exact (1 départ)", "Actions"];
    const head = element("tr");
    for (const text of headers) head.append(element("th", text));
    $("pricing-head").replaceChildren(head);
    fillRows(
      "pricing-rows",
      data.rows.map((row) => {
        const actions = element("div");
        for (const [label, clone] of [
          ["Modifier", false],
          ["Dupliquer", true],
        ]) {
          const button = element(
            "button",
            label,
            "btn btn-outline-primary btn-sm me-2",
          );
          button.type = "button";
          button.addEventListener("click", () => pricingEditor(row, clone));
          actions.append(button);
        }
        const country =
          pricingCountryName(row.country_code) + " · " + row.country_code;
        if (pricingState.kind === "rates")
          return [
            country,
            row.from_currency,
            row.to_currency,
            row.rate,
            actions,
          ];
        const summary =
          row.editor_tiers
            ?.map(
              (t) =>
                `${t.min} → ${t.max === "0" ? "sans plafond" : t.max} : ${t.fee ?? "ancien format (fixe " + (t.flat ?? "—") + ", pourcentage " + (t.percent ?? "—") + ")"}`,
            )
            .join(" / ") || "Format à corriger";
        return [
          country,
          row.transaction_type,
          row.currency,
          summary,
          row.is_active ? "Actif" : "Inactif",
          actions,
        ];
      }),
      headers.length,
    );
    $("pricing-status").textContent =
      "Règles lues dans la base Cashpay. Les clés pays/type/devise ou pays/paire restent fixes en modification ; utilisez Dupliquer pour une autre clé.";
    $("pricing-page").textContent = "Page " + (pricingState.page + 1);
    $("app-status").textContent = "Gestion financière réservée à l’Admin.";
  } catch (error) {
    $("pricing-status").textContent = error.message;
  } finally {
    pricingState.busy = false;
    $("pricing-prev").disabled = pricingState.page === 0;
    $("pricing-next").disabled = !pricingState.hasMore;
  }
}
async function bootPricing() {
  pricingState.kind = location.pathname === "/fees" ? "fees" : "rates";
  $("pricing-view").hidden = false;
  $("pricing-title").textContent =
    pricingState.kind === "fees"
      ? "Frais des services par pays"
      : "Taux de change par pays";
  $("pricing-preview").hidden = pricingState.kind !== "fees";
  $("pricing-active-filter").hidden = pricingState.kind !== "fees";
  try {
    pricingState.catalog = await api("/api/pricing/catalog");
    for (const id of [
      "pricing-filter-country",
      "pricing-country",
      "pricing-preview-country",
    ]) {
      const select = $(id);
      select.replaceChildren();
      if (id === "pricing-filter-country")
        select.add(new Option("Tous les pays", ""));
      for (const country of pricingState.catalog.countries)
        select.add(
          new Option(country.name + " (" + country.code + ")", country.code),
        );
    }
    for (const item of pricingState.catalog.types)
      $("pricing-types").append(new Option(item.note || item.code, item.code));
    for (const item of pricingState.catalog.currencies)
      $("pricing-currencies").append(new Option(item, item));
    await pricingLoad();
    await pricingHistoryLoad();
  } catch (error) {
    $("pricing-status").textContent = error.message;
  }
}
$("pricing-new").addEventListener("click", () => {
  if (pricingState.catalog) pricingEditor();
});
$("pricing-cancel").addEventListener("click", () => {
  $("pricing-editor").hidden = true;
  $("pricing-pin").value = "";
});
$("pricing-add-tier").addEventListener("click", () => pricingTier());
$("pricing-filter").addEventListener("submit", (event) => {
  event.preventDefault();
  pricingState.page = 0;
  void pricingLoad();
});
$("pricing-prev").addEventListener("click", () => {
  if (!pricingState.busy && pricingState.page > 0) {
    pricingState.page--;
    void pricingLoad();
  }
});
$("pricing-next").addEventListener("click", () => {
  if (!pricingState.busy && pricingState.hasMore) {
    pricingState.page++;
    void pricingLoad();
  }
});
$("pricing-history-prev").addEventListener("click", () => {
  if (pricingState.historyPage > 0) {
    pricingState.historyPage--;
    void pricingHistoryLoad();
  }
});
$("pricing-history-next").addEventListener("click", () => {
  if (pricingState.historyMore) {
    pricingState.historyPage++;
    void pricingHistoryLoad();
  }
});
$("pricing-country").addEventListener("change", () => {
  if (pricingState.mode === "create") {
    const local =
      pricingState.catalog.countries.find(
        (c) => c.code === $("pricing-country").value,
      )?.currency_code || "USD";
    $("pricing-currency").value = local;
    $("pricing-to").value = local === "USD" ? "EUR" : local;
  }
  pricingPolicy();
});
for (const id of [
  "pricing-type",
  "pricing-currency",
  "pricing-from",
  "pricing-to",
  "pricing-rate",
])
  $(id).addEventListener("input", pricingPolicy);
let pricingSaving = false;
$("pricing-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (pricingSaving) return;
  pricingSaving = true;
  $("pricing-save").disabled = true;
  $("pricing-result").textContent = "Enregistrement…";
  try {
    const common = {
      country_code: $("pricing-country").value,
      admin_pin: $("pricing-pin").value,
      reason: $("pricing-reason").value,
      ...(pricingState.mode === "update"
        ? { version: pricingState.current.version }
        : {}),
    };
    const body =
      pricingState.kind === "fees"
        ? {
            ...common,
            transaction_type: $("pricing-type").value,
            currency: $("pricing-currency").value,
            is_active: $("pricing-active").checked,
            fee_tiers: [
              ...$("pricing-tiers").querySelectorAll(".pricing-tier"),
            ].map((row) => ({
              min: row.querySelector("[data-field=min]").value,
              max: row.querySelector("[data-field=max]").value,
              fee:
                row.querySelector("[data-field=value]").value +
                (row.querySelector("[data-field=unit]").value === "percent"
                  ? "%"
                  : ""),
            })),
          }
        : {
            ...common,
            from_currency: $("pricing-from").value,
            to_currency: $("pricing-to").value,
            rate: $("pricing-rate").value,
          };
    const result = await api("/api/pricing/" + pricingState.kind, {
      method: pricingState.mode === "create" ? "POST" : "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify(body),
    });
    $("pricing-editor-title").textContent = "Modifier la règle";
    pricingState.current = result.row;
    pricingState.mode = "update";
    for (const id of [
      "pricing-country",
      "pricing-type",
      "pricing-currency",
      "pricing-from",
      "pricing-to",
    ])
      $(id).disabled = true;
    $("pricing-result").textContent =
      "Règle enregistrée et journalisée. Les prochains calculs utiliseront cette configuration selon le code du service.";
    await pricingLoad();
    await pricingHistoryLoad();
  } catch (error) {
    $("pricing-result").textContent = error.message;
  } finally {
    pricingSaving = false;
    $("pricing-save").disabled = false;
    $("pricing-pin").value = "";
  }
});
$("pricing-preview-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  try {
    const data = await api("/api/pricing/fee-preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        country_code: $("pricing-preview-country").value,
        transaction_type: $("pricing-preview-type").value,
        currency: $("pricing-preview-currency").value,
        amount: $("pricing-preview-amount").value,
      }),
    });
    $("pricing-preview-result").textContent = data.found
      ? `Frais configurés : ${data.fee} ${data.currency}. Barème appliqué : ${data.applied_country_code}. ${data.policy.note || ""}`
      : data.message;
  } catch (error) {
    $("pricing-preview-result").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
