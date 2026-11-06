const commState = {
  page: 1,
  detailPage: 1,
  detailId: null,
  draft: null,
  version: 0,
  busy: false,
};
const commLabels = {
  draft: "Aperçu",
  queued: "En attente",
  running: "En cours",
  completed: "Traitement terminé",
  cancelled: "Annulé",
  pending: "En attente",
  sending: "Envoi en cours",
  accepted: "Accepté fournisseur",
  failed: "Échec certain",
  unknown: "Résultat incertain",
  skipped: "Destination absente",
};
let commFocus = "comm-message";
for (const id of ["comm-subject", "comm-message"])
  $(id).addEventListener("focus", () => {
    commFocus = id;
  });
function commInvalidate() {
  commState.version++;
  commState.draft = null;
  $("comm-approval").hidden = true;
}
function commInsert(text) {
  const input = $(commFocus);
  input.focus();
  input.setRangeText(
    text,
    input.selectionStart ?? input.value.length,
    input.selectionEnd ?? input.value.length,
    "end",
  );
  commInvalidate();
}
function commDefinition() {
  return {
    channel: $("comm-channel").value,
    format: $("comm-format").value,
    subject: $("comm-subject").value,
    message: $("comm-message").value,
    asset_ids:
      $("comm-channel").value === "email"
        ? commAssets
            .filter((a) => $("comm-message").value.includes(a.cid))
            .map((a) => a.id)
        : [],
    filters: {
      country: $("comm-country").value,
      role: $("comm-role").value,
      status: $("comm-user-status").value,
      wallet_ids: $("comm-wallets")
        .value.split(/[\s,;]+/)
        .filter(Boolean),
    },
  };
}
const commAssets = [];
function commChannel() {
  const email = $("comm-channel").value === "email";
  $("comm-format").disabled = !email;
  if (!email) $("comm-format").value = "text";
  $("comm-html-tools").hidden = !email || $("comm-format").value !== "html";
}
$("comm-form").addEventListener("input", commInvalidate);
$("comm-channel").addEventListener("change", () => {
  commInvalidate();
  commChannel();
});
$("comm-format").addEventListener("change", () => {
  commInvalidate();
  commChannel();
});
for (const button of document.querySelectorAll("[data-html]"))
  button.addEventListener("click", () => {
    commFocus = "comm-message";
    const markup = {
      paragraph: "<p>Votre texte</p>",
      title: "<h2>Votre titre</h2>",
      bold: "<strong>Votre texte</strong>",
      button:
        '<p><a href="https://app.cashpay-all.com" style="background-color:#000e38;color:#ffffff;padding:12px">Ouvrir CashPay</a></p>',
    };
    commInsert(markup[button.dataset.html]);
  });
$("comm-import-html").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 50000) throw Error("Fichier HTML limité à 50 Ko.");
    $("comm-message").value = await file.text();
    $("comm-format").value = "html";
    commInvalidate();
    commChannel();
    $("comm-status").textContent =
      "HTML importé. Vérifiez son rendu avec l’aperçu.";
  } catch (error) {
    $("comm-status").textContent = error.message;
  } finally {
    event.target.value = "";
  }
});
$("comm-image").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (commAssets.length >= 8)
      throw Error("Huit images maximum par composition.");
    if (file.size > 6 * 1024 * 1024) throw Error("Image limitée à 6 Mo.");
    event.target.disabled = true;
    const asset = await api("/api/communication-assets", {
      method: "POST",
      headers: {
        "x-csrf-token": state.session.csrf,
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
      timeoutMs: 30000,
    });
    commAssets.push(asset);
    commFocus = "comm-message";
    commInsert(
      '<p><img src="' + asset.cid + '" alt="Image CashPay" width="560"></p>',
    );
    $("comm-status").textContent =
      "Image importée. Elle sera intégrée à l’e-mail.";
  } catch (error) {
    $("comm-status").textContent = error.message;
  } finally {
    event.target.disabled = false;
    event.target.value = "";
  }
});
$("comm-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (commState.busy) return;
  commState.busy = true;
  $("comm-preview-button").disabled = true;
  $("comm-send").disabled = true;
  const version = commState.version;
  try {
    const result = await api("/api/communications/preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify(commDefinition()),
      timeoutMs: 120000,
    });
    if (version !== commState.version) {
      $("comm-status").textContent =
        "La composition a changé. Générez un nouvel aperçu.";
      return;
    }
    commState.draft = result.id;
    $("comm-approval").hidden = false;
    $("comm-audience").textContent =
      result.total +
      " comptes ciblés · " +
      result.reachable +
      " destinations valides · " +
      result.skipped +
      " sans destination valide. Aucun envoi effectué.";
    $("comm-previews").replaceChildren();
    for (const preview of result.previews) {
      const box = document.createElement("div");
      box.className = "mb-3";
      const title = document.createElement("h4");
      title.className = "h6";
      title.textContent =
        (preview.first_name || "Destinataire") +
        " · " +
        preview.wallet_id +
        " — " +
        preview.subject;
      box.append(title);
      if ($("comm-channel").value === "email") {
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "");
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.title = "Aperçu e-mail " + preview.wallet_id;
        frame.style.width = "100%";
        frame.style.height = "430px";
        frame.srcdoc = preview.html;
        box.append(frame);
      } else {
        const text = document.createElement("pre");
        text.style.whiteSpace = "pre-wrap";
        text.textContent = preview.text;
        box.append(text);
      }
      $("comm-previews").append(box);
    }
    $("comm-status").textContent = result.message;
    await commHistory();
  } catch (error) {
    $("comm-status").textContent = error.message;
  } finally {
    commState.busy = false;
    $("comm-preview-button").disabled = false;
    $("comm-send").disabled = false;
  }
});
$("comm-start-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (commState.busy || !commState.draft) return;
  commState.busy = true;
  $("comm-send").disabled = true;
  try {
    const result = await api(
      "/api/communications/" + commState.draft + "/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": state.session.csrf,
        },
        body: JSON.stringify({ admin_pin: $("comm-pin").value }),
      },
    );
    commState.detailId = result.id;
    commState.detailPage = 1;
    commState.draft = null;
    $("comm-approval").hidden = true;
    $("comm-status").textContent =
      "Communication mise en file. Le suivi distingue les acceptations, échecs et résultats incertains.";
    await commHistory();
    await commDetail();
  } catch (error) {
    $("comm-status").textContent = error.message;
  } finally {
    commState.busy = false;
    $("comm-send").disabled = false;
    $("comm-pin").value = "";
  }
});
async function commHistory() {
  const data = await api("/api/communications?page=" + commState.page);
  if (data.worker?.last_error)
    $("comm-status").textContent = data.worker.last_error;
  $("comm-history").replaceChildren();
  for (const row of data.items) {
    const box = document.createElement("div");
    box.className = "border-bottom pb-3 mb-3";
    const heading = document.createElement("h3");
    heading.className = "h6";
    heading.textContent = row.subject;
    const summary = document.createElement("p");
    summary.textContent =
      (commLabels[row.status] || row.status) +
      " · " +
      row.channel +
      " · " +
      row.total +
      " destinataires";
    const count = document.createElement("p");
    count.className = "text-muted";
    count.textContent =
      "Acceptés : " +
      row.accepted +
      " · Échecs : " +
      row.failed +
      " · Incertains : " +
      row.unknown +
      " · En attente : " +
      (row.pending + row.sending) +
      " · Sans destination : " +
      row.skipped;
    const when = document.createElement("small");
    when.textContent = date(row.created_at);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm btn-outline-primary ml-2";
    button.textContent = "Voir le suivi";
    button.onclick = () => {
      commState.detailId = row.id;
      commState.detailPage = 1;
      void commDetail().catch((error) => {
        $("comm-status").textContent = error.message;
      });
    };
    box.append(heading, summary, count, when, button);
    $("comm-history").append(box);
  }
  if (!data.items.length) {
    const text = document.createElement("p");
    text.textContent = "Aucune communication enregistrée.";
    $("comm-history").append(text);
  }
  $("comm-prev").disabled = commState.page <= 1;
  $("comm-next").disabled = !data.has_more;
}
async function commDetail() {
  if (!commState.detailId) return;
  const data = await api(
    "/api/communications/" +
      commState.detailId +
      "?page=" +
      commState.detailPage,
  );
  $("comm-detail").hidden = false;
  $("comm-detail-title").textContent = data.campaign.subject;
  $("comm-detail-status").textContent =
    commLabels[data.campaign.status] || data.campaign.status;
  $("comm-deliveries").replaceChildren();
  for (const delivery of data.items) {
    const row = document.createElement("tr");
    for (const value of [
      delivery.id_wallet,
      delivery.destination || "—",
      commLabels[delivery.status] || delivery.status,
      delivery.attempts,
      delivery.provider_id || delivery.error_code || "—",
    ]) {
      const cell = document.createElement("td");
      cell.textContent = String(value);
      row.append(cell);
    }
    $("comm-deliveries").append(row);
  }
  $("comm-detail-prev").disabled = commState.detailPage <= 1;
  $("comm-detail-next").disabled = !data.has_more;
}
$("comm-control-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (commState.busy || !commState.detailId) return;
  commState.busy = true;
  try {
    await api("/api/communications/" + commState.detailId + "/control", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": state.session.csrf,
      },
      body: JSON.stringify({
        action: event.submitter?.value,
        admin_pin: $("comm-control-pin").value,
      }),
    });
    await commHistory();
    await commDetail();
  } catch (error) {
    $("comm-detail-status").textContent = error.message;
  } finally {
    commState.busy = false;
    $("comm-control-pin").value = "";
  }
});
for (const [id, change, detail] of [
  ["comm-prev", -1, false],
  ["comm-next", 1, false],
  ["comm-detail-prev", -1, true],
  ["comm-detail-next", 1, true],
])
  $(id).addEventListener("click", () => {
    if (detail) commState.detailPage += change;
    else commState.page += change;
    void (detail ? commDetail() : commHistory()).catch((error) => {
      $("comm-status").textContent = error.message;
    });
  });
$("comm-refresh").addEventListener(
  "click",
  () =>
    void Promise.all([commHistory(), commDetail()]).catch((error) => {
      $("comm-status").textContent = error.message;
    }),
);
async function bootCommunications() {
  $("communications-view").hidden = false;
  const catalog = await api("/api/communications/catalog");
  $("comm-country").replaceChildren(
    new Option("Tous les pays", ""),
    ...catalog.countries.map(
      (c) => new Option(c.name + " (" + c.code + ")", c.code),
    ),
  );
  $("comm-role").replaceChildren(
    new Option("Tous les rôles", ""),
    ...catalog.roles.map((role) => new Option(role, role)),
  );
  $("comm-user-status").replaceChildren(
    new Option("Tous les états", "all"),
    ...catalog.statuses.map((status) => new Option(status, status)),
  );
  const active = catalog.statuses.find((s) => s.toLowerCase() === "active");
  $("comm-user-status").value = active || "all";
  for (const token of catalog.tokens) {
    const button = document.createElement("button");
    button.className = "btn btn-sm btn-outline-info";
    button.type = "button";
    button.textContent = "{{" + token + "}}";
    button.addEventListener("click", () => commInsert("{{" + token + "}}"));
    $("comm-tokens").append(button);
  }
  commChannel();
  if (!catalog.ready) {
    $("comm-status").textContent =
      "Installation requise dans Adminer : " + catalog.sql;
    $("comm-preview-button").disabled = true;
    return;
  }
  await commHistory();
  const selected = new URL(location.href).searchParams.get("id");
  if (selected) {
    commState.detailId = selected;
    await commDetail();
  }
  setInterval(() => {
    if (!document.hidden && !commState.busy)
      void Promise.all([commHistory(), commDetail()]).catch((error) => {
        $("comm-status").textContent = error.message;
      });
  }, 6000);
}
