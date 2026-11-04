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
  return node;
}
function number(value) {
  try {
    return BigInt(value || 0).toLocaleString("fr-FR");
  } catch {
    return "Indisponible";
  }
}
function decimal(value) {
  const text = String(value ?? "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return "Valeur à vérifier";
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
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 401) {
    location.replace("/login");
    throw Error("Session expirée.");
  }
  const data = await response.json();
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
  return decimal(row?.amount || "0") + " " + currency;
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
        : decimal(row.amount),
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
  $("app-status").textContent =
    `Données arrêtées au ${date(data.snapshotAt)} · actualisation automatique toutes les 60 secondes.`;
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
          ? ["Date", "ID", "Type", "Marque", "État"]
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
              decimal(row.amount) + " " + row.currency,
              decimal(row.fee || "0") + " " + row.currency,
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
                badge(row.status),
              ]
            : [
                date(row.created_at),
                row.reference,
                decimal(row.amount) + " " + row.currency,
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
    const quality = data.walletQuality;
    $("user-wallet-warning").hidden =
      Number(quality.wallets) > 0 && Number(quality.invalid_wallets) === 0;
    $("user-wallet-warning").textContent =
      Number(quality.wallets) === 0
        ? "Aucun portefeuille enregistré."
        : "Le format d’un portefeuille doit être vérifié.";
    fillRows(
      "user-balance-rows",
      data.balances.map((row) => [row.currency, decimal(row.amount)]),
      2,
    );
    fillRows(
      "user-deposit-rows",
      data.deposits.map((row) => [
        row.currency,
        decimal(row.amount),
        number(row.count),
      ]),
      3,
    );
    $("app-status").textContent =
      "Fiche de consultation du compte : aucune modification ni approbation effectuée.";
    await loadActivity();
  } catch (reason) {
    error(reason.message);
  }
}
async function boot() {
  try {
    state.session = await api("/api/session");
    $("admin-name").textContent =
      state.session.user.full_name || "Administrateur";
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
    if (location.pathname === "/users") {
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
      }, 60000);
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
void boot();
