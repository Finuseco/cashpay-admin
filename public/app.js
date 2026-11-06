const $ = (id) => document.getElementById(id),
  state = {
    session: null,
    charts: new Map(),
    dashboard: null,
    usersPage: 0,
    userHasMore: false,
    activityPage: 0,
    activityHasMore: false,
    kind: "transactions",
    userId: null,
    busy: false,
  };
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (className) node.className = className;
  const actionIcon = {
    Consulter: "eye-outline",
    Modifier: "pencil",
    Dupliquer: "content-copy",
    Retirer: "delete-outline",
  }[text];
  if (["a", "button"].includes(tag) && actionIcon) {
    const icon = document.createElement("i");
    icon.className = "mdi mdi-" + actionIcon;
    icon.setAttribute("aria-hidden", "true");
    node.prepend(icon, document.createTextNode(" "));
  }
  return node;
}
function number(value) {
  try {
    return BigInt(value || 0).toLocaleString("fr-FR");
  } catch {
    return "Indisponible";
  }
}
function decimal(value, currency) {
  const text = String(value ?? "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return "Valeur à vérifier";
  if (
    String(currency || "")
      .trim()
      .toUpperCase() === "EUR"
  ) {
    const negative = text.startsWith("-");
    const [whole, fraction = ""] = text.replace(/^[+-]/, "").split(".");
    let cents = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
    if (Number(fraction[2] || 0) >= 5) cents++;
    return (
      (negative && cents > 0n ? "-" : "") +
      (cents / 100n).toLocaleString("fr-FR") +
      "," +
      String(cents % 100n).padStart(2, "0")
    );
  }
  const [integer, fraction] = text.split(".");
  return (
    BigInt(integer).toLocaleString("fr-FR") + (fraction ? "," + fraction : "")
  );
}
function date(value) {
  if (!value) return "Non renseignée";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date invalide"
    : new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(parsed);
}
function error(message) {
  $("app-error").hidden = !message;
  $("app-error").textContent = message || "";
}
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs || 20000),
  });
  if (response.status === 401) {
    location.replace("/login");
    throw Error("Session expirée.");
  }
  if (response.status === 413)
    throw Error(
      "Fichier refusé par le proxy : vérifier la limite de téléversement de 8 Mo dans Nginx.",
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      "Réponse du serveur indisponible ou invalide (HTTP " +
        response.status +
        "). Réessayez ou consultez les journaux du service.",
    );
  }
  if (!response.ok) throw Error(data.error || "Service indisponible.");
  return data;
}
function fillRows(id, rows, width) {
  const body = $(id);
  body.replaceChildren();
  if (!rows.length) {
    const row = element("tr"),
      cell = element("td", "Aucune donnée disponible.", "text-muted");
    cell.colSpan = width;
    row.append(cell);
    body.append(row);
  } else
    for (const cells of rows) {
      const row = element("tr");
      for (const content of cells) {
        const cell = element("td");
        cell.append(
          content instanceof Node
            ? content
            : document.createTextNode(String(content ?? "—")),
        );
        row.append(cell);
      }
      body.append(row);
    }
}
function badge(value) {
  return element("span", value, "badge badge-outline-info");
}
function chart(id, type, labels, datasets) {
  state.charts.get(id)?.destroy();
  state.charts.set(
    id,
    new Chart($(id), {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { labels: { color: "#d4d4d8" } } },
        ...(type !== "doughnut"
          ? {
              scales: {
                x: { ticks: { color: "#b3b3b3" }, grid: { color: "#2c2e33" } },
                y: {
                  beginAtZero: true,
                  ticks: { color: "#b3b3b3" },
                  grid: { color: "#2c2e33" },
                },
              },
            }
          : {}),
      },
    }),
  );
}
function metric(label, value, icon, color = "primary") {
  const column = element(
      "div",
      null,
      "col-xl-3 col-sm-6 grid-margin stretch-card",
    ),
    card = element("div", null, "card"),
    body = element("div", null, "card-body"),
    line = element(
      "div",
      null,
      "d-flex align-items-center justify-content-between",
    ),
    box = element("div", null, `icon icon-box-${color}`);
  box.append(element("span", null, `mdi ${icon} icon-item`));
  line.append(element("h3", value, "mb-0"), box);
  body.append(line, element("h6", label, "text-muted font-weight-normal mt-3"));
  card.append(body);
  column.append(card);
  return column;
}
function balance(currency, data) {
  const row = data.balances.find((item) => item.currency === currency);
  if (
    Number(data.balanceQuality.invalid_wallets) > 0 ||
    (row && Number(row.invalid_entries) > 0)
  )
    return "Incomplet";
  return decimal(row?.amount || "0", currency) + " " + currency;
}
function renderVolume() {
  const data = state.dashboard,
    currency = $("volume-currency").value,
    months = data.monthly.map((row) => row.month);
  chart("volume-chart", "bar", months, [
    {
      label: currency
        ? `Dépôts enregistrés (${currency})`
        : "Aucun dépôt sur la période",
      data: months.map((month) =>
        Number(
          data.depositVolumes.find(
            (row) => row.month === month && row.currency === currency,
          )?.amount || 0,
        ),
      ),
      backgroundColor: "#0090e7",
    },
  ]);
}
function renderDashboard(data) {
  const counts = data.counts,
    cards = $("metric-cards");
  cards.replaceChildren();
  for (const args of [
    [
      "Comptes enregistrés, tous rôles",
      number(counts.users),
      "mdi-account-multiple",
    ],
    [
      "Comptes actifs",
      number(counts.active_users),
      "mdi-account-check",
      "success",
    ],
    ["Pays représentés", number(counts.represented_countries), "mdi-earth"],
    [
      "Pays avec compte actif",
      number(counts.active_countries),
      "mdi-map-check",
      "success",
    ],
    [
      "Titulaires avec dépôt confirmé",
      number(counts.with_deposit),
      "mdi-bank-transfer-in",
      "success",
    ],
    [
      "Sans dépôt confirmé",
      number(counts.without_deposit),
      "mdi-account-clock",
      "warning",
    ],
    ["Somme des soldes USD", balance("USD", data), "mdi-cash-multiple"],
    ["Somme des soldes EUR", balance("EUR", data), "mdi-cash-multiple"],
  ])
    cards.append(metric(...args));
  const invalid =
    Number(data.balanceQuality.invalid_wallets) > 0 ||
    data.balances.some((row) => Number(row.invalid_entries) > 0);
  $("balance-warning").hidden = !invalid;
  $("balance-warning").textContent = invalid
    ? "Certaines valeurs de portefeuille sont invalides. Les sommes concernées ne sont pas présentées comme complètes."
    : "";
  chart(
    "deposit-chart",
    "doughnut",
    ["Avec dépôt confirmé", "Sans dépôt confirmé"],
    [
      {
        data: [Number(counts.with_deposit), Number(counts.without_deposit)],
        backgroundColor: ["#00d25b", "#ffab00"],
        borderColor: "#191c24",
      },
    ],
  );
  chart(
    "registration-chart",
    "bar",
    data.monthly.map((row) => row.month),
    [
      {
        label: "Inscriptions",
        data: data.monthly.map((row) => Number(row.registrations)),
        backgroundColor: "#0090e7",
      },
      {
        label: "Premiers déposants",
        data: data.monthly.map((row) => Number(row.first_depositors)),
        backgroundColor: "#00d25b",
      },
    ],
  );
  const previous = $("volume-currency").value,
    select = $("volume-currency");
  select.replaceChildren();
  for (const currency of [
    ...new Set(data.depositVolumes.map((row) => row.currency)),
  ].sort())
    select.append(new Option(currency, currency));
  if ([...select.options].some((option) => option.value === previous))
    select.value = previous;
  else if ([...select.options].some((option) => option.value === "USD"))
    select.value = "USD";
  renderVolume();
  fillRows(
    "currency-rows",
    data.balances.map((row) => [
      row.currency || "Devise vide",
      Number(data.balanceQuality.invalid_wallets) > 0 ||
      Number(row.invalid_entries) > 0
        ? "Incomplet"
        : decimal(row.amount, row.currency),
      number(row.funded_users),
    ]),
    3,
  );
  fillRows(
    "country-rows",
    data.countries.map((row) => [
      row.name,
      number(row.users),
      number(row.active_users),
      number(row.with_deposit),
    ]),
    4,
  );
  const queues = $("queue-summary");
  queues.replaceChildren();
  for (const [label, section] of [
    ["Demandes de cartes", data.cards],
    ["Commandes", data.orders],
  ]) {
    queues.append(element("h3", label, "h6 mt-3"));
    if (!section.available)
      queues.append(element("p", section.error, "text-warning"));
    else if (!section.rows.length)
      queues.append(element("p", "Aucune demande.", "text-muted"));
    else
      for (const row of section.rows)
        queues.append(element("p", `${row.status} : ${number(row.count)}`));
  }
  renderFinance(data.finance);
  if (location.hash === "#finance-view" && !state.financeAnchorShown) {
    state.financeAnchorShown = true;
    requestAnimationFrame(() => $("finance-view").scrollIntoView());
  }
  $("app-status").textContent =
    `Données arrêtées au ${date(data.snapshotAt)} · actualisation automatique toutes les 10 secondes.`;
}
async function loadDashboard() {
  if (state.busy) return;
  state.busy = true;
  $("refresh").disabled = true;
  $("country-filter").disabled = true;
  error("");
  try {
    const selected = $("country-filter").value;
    const data = await api(
      "/api/dashboard" +
        (selected ? "?country=" + encodeURIComponent(selected) : ""),
    );
    state.dashboard = data;
    if (!selected) {
      const current = $("country-filter").value;
      const options = [
        new Option("Tous les pays", ""),
        ...data.countries
          .filter((row) => row.country)
          .map((row) => new Option(row.name, row.country)),
      ];
      $("country-filter").replaceChildren(...options);
      $("country-filter").value = current;
    }
    renderDashboard(data);
  } catch (reason) {
    error(reason.message);
    if (state.dashboard)
      $("country-filter").value = state.dashboard.country || "";
    $("app-status").textContent = state.dashboard
      ? "Actualisation échouée : les données précédentes restent affichées."
      : "Aucune statistique confirmée.";
  } finally {
    state.busy = false;
    $("refresh").disabled = false;
    $("country-filter").disabled = false;
  }
}
async function loadUsers() {
  if (state.busy) return;
  state.busy = true;
  error("");
  $("search").disabled = true;
  $("user-rows").replaceChildren();
  $("users-prev").disabled = true;
  $("users-next").disabled = true;
  try {
    const data = await api(
      `/api/users?search=${encodeURIComponent($("search").value)}&page=${state.usersPage}`,
    );
    state.userHasMore = data.hasMore;
    fillRows(
      "user-rows",
      data.users.map((user) => {
        const link = element(
          "a",
          "Consulter",
          "btn btn-outline-primary btn-sm",
        );
        link.href = "/users/" + user.id;
        return [
          user.full_name,
          user.id_wallet,
          user.phone,
          user.country,
          badge(user.role),
          badge(user.status),
          link,
        ];
      }),
      7,
    );
    $("users-page").textContent = "Page " + (state.usersPage + 1);
    $("app-status").textContent =
      "Résultats issus de la base, 25 comptes par page.";
  } catch (reason) {
    error(reason.message);
  } finally {
    state.busy = false;
    $("search").disabled = false;
    $("users-prev").disabled = state.usersPage === 0;
    $("users-next").disabled = !state.userHasMore;
  }
}
async function loadActivity() {
  if (state.busy) return;
  state.busy = true;
  error("");
  $("activity-prev").disabled = true;
  $("activity-next").disabled = true;
  $("activity-rows").replaceChildren();
  $("activity-status").textContent = "Chargement…";
  try {
    const data = await api(
      `/api/users/${state.userId}/activity?kind=${state.kind}&page=${state.activityPage}`,
    );
    const labels =
      state.kind === "transactions"
        ? ["Date", "Référence", "Type", "Montant", "Frais", "État", "Sens"]
        : state.kind === "cards"
          ? ["Date", "ID", "Type", "Marque", "Devise", "État"]
          : ["Date", "Référence", "Montant", "État"];
    const head = element("tr");
    for (const label of labels) head.append(element("th", label));
    $("activity-head").replaceChildren(head);
    state.activityHasMore = data.hasMore;
    fillRows(
      "activity-rows",
      data.rows.map((row) =>
        state.kind === "transactions"
          ? [
              date(row.created_at),
              row.reference_code,
              row.type_code,
              decimal(row.amount, row.currency) + " " + row.currency,
              decimal(row.fee || "0", row.currency) + " " + row.currency,
              badge(row.status),
              Number(row.sender_id) === Number(state.userId)
                ? "Titulaire / émetteur"
                : "Bénéficiaire",
            ]
          : state.kind === "cards"
            ? [
                date(row.created_at),
                row.id,
                row.card_type,
                row.brand,
                row.currency || "Non renseignée",
                badge(row.status),
              ]
            : [
                date(row.created_at),
                row.reference,
                decimal(row.amount, row.currency) + " " + row.currency,
                badge(row.status),
              ],
      ),
      labels.length,
    );
    $("activity-status").textContent = data.available
      ? "Les statuts sont ceux enregistrés dans Cashpay."
      : data.error;
    $("activity-page").textContent = "Page " + (state.activityPage + 1);
  } catch (reason) {
    error(reason.message);
    $("activity-status").textContent = "Activités indisponibles.";
  } finally {
    state.busy = false;
    $("activity-prev").disabled = state.activityPage === 0;
    $("activity-next").disabled = !state.activityHasMore;
  }
}
async function loadProfile() {
  error("");
  try {
    const data = await api("/api/users/" + state.userId),
      user = data.user,
      heading = $("user-heading");
    heading.replaceChildren();
    const icon = element("i", null, "mdi mdi-account-circle icon-lg me-3");
    heading.append(icon);
    if (user.profile_photo) {
      const image = element("img", null, "img-lg rounded-circle me-3");
      image.src = user.profile_photo;
      image.alt = "Avatar du compte";
      image.addEventListener("load", () => {
        icon.hidden = true;
      });
      image.addEventListener("error", () => image.remove());
      heading.append(image);
    }
    heading.append(element("h1", user.full_name || user.id_wallet, "h3"));
    const facts = $("user-facts");
    facts.replaceChildren();
    for (const [label, value] of [
      ["ID Wallet", user.id_wallet],
      ["Téléphone", user.phone],
      ["E-mail", user.email],
      ["Pays", user.country],
      ["Province", user.province],
      ["Ville", user.city],
      ["Rôle", user.role],
      ["État", user.status],
      ["Création", date(user.created_at)],
    ]) {
      facts.append(
        element("dt", label, "col-sm-4"),
        element("dd", value || "Non renseigné", "col-sm-8"),
      );
    }
    const financial = data.financialAccess !== false;
    $("user-financial-data").hidden = !financial;
    document
      .querySelectorAll("[data-kind]")
      .forEach(
        (button) =>
          (button.hidden = !financial && button.dataset.kind !== "cards"),
      );
    if (!financial) {
      state.kind = "cards";
      document
        .querySelectorAll("[data-kind]")
        .forEach((button) =>
          button.classList.toggle("active", button.dataset.kind === "cards"),
        );
    }
    if (financial) {
      const quality = data.walletQuality;
      $("user-wallet-warning").hidden =
        Number(quality.wallets) > 0 && Number(quality.invalid_wallets) === 0;
      $("user-wallet-warning").textContent =
        Number(quality.wallets) === 0
          ? "Aucun portefeuille enregistré."
          : "Le format d’un portefeuille doit être vérifié.";
      fillRows(
        "user-balance-rows",
        data.balances.map((row) => [
          row.currency,
          decimal(row.amount, row.currency),
        ]),
        2,
      );
      fillRows(
        "user-deposit-rows",
        data.deposits.map((row) => [
          row.currency,
          decimal(row.amount, row.currency),
          number(row.count),
        ]),
        3,
      );
    }
    $("app-status").textContent =
      "Fiche de consultation du compte : aucune modification ni approbation effectuée.";
    await loadActivity();
    await renderClientManagement(user);
    await setupStaffActions(user);
  } catch (reason) {
    error(reason.message);
  }
}
async function boot() {
  try {
    state.session = await api("/api/session");
    staffMenus();
    renderStaffIdentity(state.session.user);
    document
      .querySelectorAll(".sidebar .nav-link")
      .forEach((link) =>
        link
          .closest(".nav-item")
          ?.classList.toggle(
            "active",
            link.getAttribute("href") === location.pathname,
          ),
      );
    if (location.pathname === "/profile") {
      bootStaffProfile();
    } else if (location.pathname === "/communications") {
      await bootCommunications();
    } else if (["/fees", "/exchange-rates"].includes(location.pathname)) {
      await bootPricing();
    } else if (
      ["/transactions", "/cards", "/orders", "/registrations"].includes(
        location.pathname,
      )
    ) {
      await loadOperations();
    } else if (location.pathname === "/users/new") {
      $("create-user-view").hidden = false;
      const data = await api("/api/registration/countries");
      const select = $("create-country");
      select.replaceChildren(new Option("Choisir un pays", ""));
      for (const country of data.countries)
        select.add(new Option(country.name, country.code));
      $("app-status").textContent =
        "Inscription dans votre périmètre autorisé. Aucun solde initial ni rôle privilégié attribué.";
    } else if (["/users", "/roles"].includes(location.pathname)) {
      $("users-view").hidden = false;
      await loadUsers();
    } else if (/^\/users\/[1-9]\d*$/.test(location.pathname)) {
      $("user-view").hidden = false;
      state.userId = location.pathname.split("/")[2];
      await loadProfile();
    } else {
      $("dashboard-view").hidden = false;
      await loadDashboard();
      setInterval(() => {
        if (!document.hidden) void loadDashboard();
      }, 10000);
    }
  } catch (reason) {
    error(reason.message);
  }
}
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {
      method: "POST",
      headers: { "x-csrf-token": state.session.csrf },
    });
    location.replace("/login");
  } catch (reason) {
    error(reason.message);
  }
});
$("refresh").addEventListener("click", () => void loadDashboard());
$("country-filter").addEventListener("change", () => void loadDashboard());
$("volume-currency").addEventListener("change", renderVolume);
$("user-search").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.busy) return;
  state.usersPage = 0;
  void loadUsers();
});
$("users-prev").addEventListener("click", () => {
  if (state.busy) return;
  if (state.usersPage > 0) {
    state.usersPage--;
    void loadUsers();
  }
});
$("users-next").addEventListener("click", () => {
  if (state.busy) return;
  if (state.userHasMore) {
    state.usersPage++;
    void loadUsers();
  }
});
$("activity-prev").addEventListener("click", () => {
  if (state.busy) return;
  if (state.activityPage > 0) {
    state.activityPage--;
    void loadActivity();
  }
});
$("activity-next").addEventListener("click", () => {
  if (state.busy) return;
  if (state.activityHasMore) {
    state.activityPage++;
    void loadActivity();
  }
});
document.querySelectorAll("[data-kind]").forEach((button) =>
  button.addEventListener("click", () => {
    if (state.busy) return;
    state.kind = button.dataset.kind;
    state.activityPage = 0;
    document
      .querySelectorAll("[data-kind]")
      .forEach((item) => item.classList.toggle("active", item === button));
    void loadActivity();
  }),
);
document.addEventListener("DOMContentLoaded", () => void boot());

function financeAmount(value, unknown = 0, currency) {
  return Number(unknown) > 0 || value === null || value === undefined
    ? "Incomplet / indisponible"
    : decimal(value, currency);
}
function renderFeeChart() {
  const finance = state.dashboard?.finance;
  if (!finance) return;
  const currency = $("fee-currency").value;
  const months = state.dashboard.monthly.map((row) => row.month);
  chart("fee-chart", "bar", months, [
    {
      label: `Frais bruts inscrits (${currency || "—"})`,
      backgroundColor: "#8f5fe8",
      data: months.map((month) => {
        const row = finance.monthly.find(
          (item) => item.month === month && item.currency === currency,
        );
        return row
          ? Number(row.unknown_fees) > 0
            ? null
            : Number(row.fees)
          : 0;
      }),
    },
  ]);
}
function renderFinance(finance) {
  $("finance-view").hidden = false;
  const warnings = $("finance-warnings");
  warnings.replaceChildren();
  const warn = (text) => warnings.append(element("p", text, "text-warning"));
  for (const [label, section] of [
    ["Registre crypto", finance.crypto],
    ["Commissions", finance.commissions],
    ["Taux de change", finance.rates],
    ["Comptes de revenus", finance.treasury.revenueRegistry],
    ["Flotte B2B", finance.treasury.floatRegistry],
  ])
    if (!section.available)
      warn(
        label + " : schéma indisponible. Aucun solde de remplacement affiché.",
      );
  if (finance.treasury.accounts.some((row) => row.error))
    warn(
      "Des comptes référencés sont introuvables ou invalides : les totaux de trésorerie sont incomplets.",
    );
  warn(
    "Les comptes bancaires et portefeuilles blockchain externes ne sont pas interrogés par cette vue. Aucun montant fictif utilisé.",
  );
  fillRows(
    "finance-fee-rows",
    finance.fees.map((row) => [
      row.currency || "Devise absente",
      number(row.count),
      financeAmount(row.fees, row.unknown_fees, row.currency),
      Number(row.unknown_fees) > 0
        ? "Incomplet"
        : decimal(row.month_fees || "0", row.currency),
      Number(row.unknown_fees) > 0 ? "Frais manquants" : "Registre",
    ]),
    5,
  );
  fillRows(
    "finance-mirror-rows",
    finance.mirrors.map((row) => [
      row.source_currency,
      financeAmount(row.source_amount, row.unknown_fees, row.source_currency),
      row.target_currency,
      row.rate ? decimal(row.rate) : "Taux indisponible",
      row.rate
        ? financeAmount(row.amount, row.unknown_fees, row.target_currency)
        : "Indisponible",
    ]),
    5,
  );
  fillRows(
    "finance-crypto-rows",
    finance.crypto.rows.map((row) => [
      row.currency,
      financeAmount(row.amount, row.invalid_entries, row.currency),
      number(row.accounts),
      Number(row.invalid_entries) > 0 ? "Incomplet" : "Solde en base",
    ]),
    4,
  );
  fillRows(
    "finance-commission-rows",
    finance.commissions.rows.map((row) => [
      row.currency,
      financeAmount(row.amount, row.invalid_entries, row.currency),
      Number(row.invalid_entries) > 0 ? "Incomplet" : "Solde en base",
    ]),
    3,
  );
  fillRows(
    "finance-treasury-total-rows",
    finance.treasury.totals.map((row) => [
      row.currency,
      financeAmount(row.amount, row.invalid_entries, row.currency),
      !finance.treasury.revenueRegistry.available ||
      !finance.treasury.floatRegistry.available ||
      finance.treasury.accounts.some((account) => account.error)
        ? "Comptes manquants / incomplet"
        : Number(row.invalid_entries) > 0
          ? "Incomplet"
          : "Portefeuilles dédupliqués",
    ]),
    3,
  );
  const accounts = [];
  for (const row of finance.treasury.accounts) {
    const sources = row.sources
      .map((source) =>
        [source.source, source.country, source.purpose, source.status]
          .filter(Boolean)
          .join(" · "),
      )
      .join(" / ");
    if (!row.balances.length)
      accounts.push([
        row.wallet_id,
        sources,
        "—",
        "Indisponible",
        row.error || "Aucun solde enregistré",
      ]);
    for (const balance of row.balances)
      accounts.push([
        row.wallet_id,
        sources,
        balance.currency,
        balance.valid ? decimal(balance.amount, balance.currency) : "Invalide",
        row.error || "Portefeuille interne",
      ]);
  }
  fillRows("finance-account-rows", accounts, 5);
  fillRows(
    "finance-flow-rows",
    finance.flows.map((row) => [
      row.type_code,
      row.status,
      row.currency,
      number(row.count),
      financeAmount(row.amount, row.unknown_amounts, row.currency),
      financeAmount(row.fees, row.unknown_fees, row.currency),
    ]),
    6,
  );
  fillRows(
    "finance-corridor-rows",
    finance.corridors.map((row) => [
      row.sender_country,
      row.receiver_country,
      row.currency,
      number(row.count),
      financeAmount(row.amount, row.unknown_amounts, row.currency),
      financeAmount(row.fees, row.unknown_fees, row.currency),
    ]),
    6,
  );
  fillRows(
    "finance-recent-rows",
    finance.recent.map((row) => [
      date(row.created_at),
      row.reference_code,
      row.type_code,
      row.status,
      row.currency,
      financeAmount(row.amount, 0, row.currency),
      financeAmount(row.fee, 0, row.currency),
      row.sender_country || "Non renseigné / externe",
      row.receiver_country || "Non renseigné / externe",
    ]),
    9,
  );
  const selected = $("fee-currency").value;
  $("fee-currency").replaceChildren();
  for (const currency of [
    ...new Set(finance.fees.map((row) => row.currency).filter(Boolean)),
  ])
    $("fee-currency").add(new Option(currency, currency));
  if (
    [...$("fee-currency").options].some((option) => option.value === selected)
  )
    $("fee-currency").value = selected;
  renderFeeChart();
}
$("fee-currency").addEventListener("change", renderFeeChart);
