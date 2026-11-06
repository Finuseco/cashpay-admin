import { queueActionNotice } from "./message-outbox.js";
import crypto from "node:crypto";
import countries from "./registration-countries.json" with { type: "json" };
import policy from "./pricing-policy.json" with { type: "json" };
import { readSnapshot } from "./db.js";
import { adminPin } from "./client-management.js";
import { deny } from "./staff-access.js";
const bad = (message) => deny(message, 400);
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function decimalText(value) {
  if (typeof value !== "string" && typeof value !== "number")
    throw bad("Valeur décimale requise.");
  let text = String(value).trim().replace(",", ".");
  if (text.length > 64 || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(text))
    throw bad("Nombre positif ou nul requis, sans séparateur de milliers.");
  if (/[eE]/.test(text)) {
    const [base, exponent] = text.toLowerCase().split("e"),
      [whole, fraction = ""] = base.split("."),
      position = whole.length + Number(exponent),
      digits = whole + fraction;
    if (position < -18 || position > 30)
      throw bad("Valeur hors précision autorisée.");
    text =
      position <= 0
        ? "0." + "0".repeat(-position) + digits
        : position >= digits.length
          ? digits + "0".repeat(position - digits.length)
          : digits.slice(0, position) + "." + digits.slice(position);
  }
  let [whole, fraction = ""] = text.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.replace(/0+$/, "");
  if (whole.length > 16 || fraction.length > 18)
    throw bad("Précision numérique excessive.");
  return whole + (fraction ? "." + fraction : "");
}
function engineNumber(value) {
  const text = decimalText(value),
    number = Number(text);
  if (
    !Number.isFinite(number) ||
    number > Number.MAX_SAFE_INTEGER ||
    decimalText(String(number)) !== text
  )
    throw bad("Cette valeur dépasse la précision du moteur de frais.");
  return { text, number };
}
function cmp(a, b) {
  const [ai, af = ""] = a.split("."),
    [bi, bf = ""] = b.split("."),
    scale = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(scale, "0")),
    y = BigInt(bi + bf.padEnd(scale, "0"));
  return x < y ? -1 : x > y ? 1 : 0;
}
function country(value, optional = false) {
  if (optional && (value === undefined || value === "")) return null;
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (code !== "GBL" && !countries.some((c) => c.code === code))
    throw bad("Sélectionnez un pays ou le périmètre global GBL.");
  return code;
}
function currency(value, optional = false) {
  if (optional && (value === undefined || value === "")) return null;
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9_]{2,15}$/.test(code)) throw bad("Code devise invalide.");
  return code;
}
function type(value) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(code))
    throw bad("Code de frais invalide (lettres, chiffres et tiret bas).");
  return code;
}
export function feePolicy(transactionType, currencyCode) {
  return {
    globalOnly:
      policy.globalTypes.includes(transactionType) ||
      (transactionType === "TICKET_BUY" &&
        ["USD", "EUR"].includes(currencyCode)),
    note: policy.notes[transactionType] || null,
    recognized: policy.knownTypes.includes(transactionType),
  };
}
function tiers(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50)
    throw bad("Définissez entre 1 et 50 paliers.");
  let previous = null;
  return value.map((tier) => {
    if (
      !tier ||
      typeof tier !== "object" ||
      Object.keys(tier).some((key) => !["min", "max", "fee"].includes(key))
    )
      throw bad("Palier invalide.");
    const min = engineNumber(tier.min),
      max = engineNumber(tier.max);
    if (max.text !== "0" && cmp(max.text, min.text) < 0)
      throw bad("La borne maximale précède la borne minimale.");
    if (previous && (previous.max === "0" || cmp(min.text, previous.max) < 0))
      throw bad("Les paliers se chevauchent ou ne sont pas classés.");
    const raw = typeof tier.fee === "string" ? tier.fee.trim() : "";
    const percent = raw.endsWith("%");
    const fee = engineNumber(percent ? raw.slice(0, -1) : raw);
    previous = { max: max.text };
    return {
      min: min.number,
      max: max.number,
      fee: fee.text + (percent ? "%" : ""),
    };
  });
}
const feeColumns = `country_code,transaction_type,currency,is_active,fee_tiers::text AS raw_tiers,CASE WHEN jsonb_typeof(fee_tiers::jsonb)='array' THEN (SELECT jsonb_agg(jsonb_build_object('min',t->>'min','max',t->>'max','fee',t->>'fee','flat',t->>'flat','percent',t->>'percent')) FROM jsonb_array_elements(fee_tiers::jsonb) t) ELSE NULL END AS editor_tiers`;
function feeDTO(row) {
  return {
    ...row,
    version: digest([
      row.country_code,
      row.transaction_type,
      row.currency,
      row.is_active,
      row.raw_tiers,
    ]),
    policy: feePolicy(row.transaction_type, row.currency),
  };
}
function rateDTO(row) {
  return {
    ...row,
    version: digest([
      row.country_code,
      row.from_currency,
      row.to_currency,
      row.rate,
    ]),
  };
}
function searchArgs(query) {
  if (
    typeof (query.search || "") !== "string" ||
    (query.search || "").length > 100
  )
    throw bad("Recherche limitée à 100 caractères.");
  return [
    country(query.country_code, true),
    "%" + (query.search || "").trim().replace(/[\\%_]/g, "\\$&") + "%",
  ];
}
export async function pricingCatalog(pool) {
  return readSnapshot(pool, async (db) => {
    const { rows: stored } = await db.query(
      "SELECT DISTINCT transaction_type FROM fee_structures ORDER BY transaction_type",
    );
    const { rows: rates } = await db.query(
      "SELECT from_currency AS currency FROM exchange_rates UNION SELECT to_currency FROM exchange_rates UNION SELECT currency FROM fee_structures ORDER BY currency",
    );
    return {
      countries: [
        { code: "GBL", name: "Global / replis (GBL)", currency_code: "USD" },
        ...countries,
      ],
      types: [
        ...new Set([
          ...policy.knownTypes,
          ...stored.map((row) => row.transaction_type),
        ]),
      ]
        .sort()
        .map((code) => ({
          code,
          globalOnly: policy.globalTypes.includes(code),
          note: policy.notes[code] || null,
          recognized: policy.knownTypes.includes(code),
        })),
      currencies: [
        ...new Set(
          [
            "USD",
            "EUR",
            "BTC",
            "ETH",
            "USDT",
            "USDT_TRC20",
            ...countries.map((c) => c.currency_code),
            ...rates.map((r) => r.currency),
          ].filter(Boolean),
        ),
      ].sort(),
      policy,
    };
  });
}
export async function listFees(pool, query, page) {
  const args = searchArgs(query);
  const active =
    query.active === "true" ? true : query.active === "false" ? false : null;
  args.push(currency(query.currency, true), active, page * 25);
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT ${feeColumns} FROM fee_structures WHERE ($1::text IS NULL OR country_code=$1) AND (transaction_type ILIKE $2 OR currency ILIKE $2 OR country_code ILIKE $2) AND ($3::text IS NULL OR currency=$3) AND ($4::boolean IS NULL OR is_active=$4) ORDER BY country_code,transaction_type,currency LIMIT 26 OFFSET $5`,
      args,
    );
    return {
      rows: rows.slice(0, 25).map(feeDTO),
      hasMore: rows.length > 25,
      page,
    };
  });
}
export async function listRates(pool, query, page) {
  const args = searchArgs(query);
  args.push(page * 25);
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      "SELECT country_code,from_currency,to_currency,rate::text AS rate FROM exchange_rates WHERE ($1::text IS NULL OR country_code=$1) AND (from_currency ILIKE $2 OR to_currency ILIKE $2 OR country_code ILIKE $2) ORDER BY country_code,from_currency,to_currency LIMIT 26 OFFSET $3",
      args,
    );
    return {
      rows: rows.slice(0, 25).map(rateDTO),
      hasMore: rows.length > 25,
      page,
    };
  });
}
export async function savePricing(pool, actor, kind, mode, body) {
  if (actor.role !== "Admin") throw deny();
  if (
    !["fees", "rates"].includes(kind) ||
    !["create", "update"].includes(mode) ||
    !body ||
    typeof body !== "object"
  )
    throw bad("Opération invalide.");
  const fields =
    kind === "fees"
      ? [
          "country_code",
          "transaction_type",
          "currency",
          "fee_tiers",
          "is_active",
          "admin_pin",
          "reason",
          "version",
        ]
      : [
          "country_code",
          "from_currency",
          "to_currency",
          "rate",
          "admin_pin",
          "reason",
          "version",
        ];
  if (Object.keys(body).some((key) => !fields.includes(key)))
    throw bad("Champ non autorisé.");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500)
    throw bad("Indiquez un motif de 10 à 500 caractères.");
  const code = country(body.country_code);
  let value, key;
  if (kind === "fees") {
    const transactionType = type(body.transaction_type),
      cur = currency(body.currency);
    if (typeof body.is_active !== "boolean") throw bad("État actif requis.");
    if (
      body.is_active &&
      feePolicy(transactionType, cur).globalOnly &&
      code !== "GBL"
    )
      throw bad(
        "Ce type de frais est lu uniquement au niveau GBL. Sélectionnez Global.",
      );
    const embedded = /^(?:BUY_CARDS|WD_ATM)_(USD|EUR|CDF)(?:_|$)/.exec(
      transactionType,
    );
    if (body.is_active && embedded && embedded[1] !== cur)
      throw bad("Ce code de frais utilise la devise " + embedded[1] + ".");
    value = {
      country_code: code,
      transaction_type: transactionType,
      currency: cur,
      fee_tiers: tiers(body.fee_tiers),
      is_active: body.is_active,
    };
    key = [code, transactionType, cur];
  } else {
    const from = currency(body.from_currency),
      to = currency(body.to_currency),
      rate = engineNumber(body.rate).text;
    if (
      from === to ||
      rate === "0" ||
      !Number.isFinite(Number(rate)) ||
      Number(rate) > Number.MAX_SAFE_INTEGER
    )
      throw bad("Paire distincte et taux strictement positif requis.");
    value = { country_code: code, from_currency: from, to_currency: to, rate };
    key = [code, from, to];
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query("SET LOCAL statement_timeout='10s'");
    const operator = await adminPin(db, actor, body.admin_pin);
    if (operator.role !== "Admin") throw deny();
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      kind + ":" + key.join(":"),
    ]);
    const select =
      kind === "fees"
        ? `SELECT ${feeColumns} FROM fee_structures WHERE country_code=$1 AND transaction_type=$2 AND currency=$3`
        : "SELECT country_code,from_currency,to_currency,rate::text AS rate FROM exchange_rates WHERE country_code=$1 AND from_currency=$2 AND to_currency=$3";
    const current = await db.query(select + " FOR UPDATE", key);
    if (current.rows.length > 1)
      throw deny(
        "Plusieurs règles existent pour cette clé. Corrigez le doublon avant de modifier.",
        409,
      );
    const before = current.rows[0];
    if (mode === "create" && before)
      throw deny("Cette règle existe déjà. Utilisez Modifier.", 409);
    if (mode === "update" && !before)
      throw deny("Règle introuvable. Actualisez la liste.", 404);
    if (
      mode === "update" &&
      body.version !==
        (kind === "fees" ? feeDTO(before) : rateDTO(before)).version
    )
      throw deny("La règle a changé. Rechargez avant de modifier.", 409);
    if (kind === "fees") {
      if (mode === "create")
        await db.query(
          "INSERT INTO fee_structures (country_code,transaction_type,currency,fee_tiers,is_active) VALUES ($1,$2,$3,$4::jsonb,$5)",
          [...key, JSON.stringify(value.fee_tiers), value.is_active],
        );
      else
        await db.query(
          "UPDATE fee_structures SET fee_tiers=$4::jsonb,is_active=$5 WHERE country_code=$1 AND transaction_type=$2 AND currency=$3",
          [...key, JSON.stringify(value.fee_tiers), value.is_active],
        );
    } else {
      if (mode === "create")
        await db.query(
          "INSERT INTO exchange_rates (country_code,from_currency,to_currency,rate) VALUES ($1,$2,$3,$4::numeric)",
          [...key, value.rate],
        );
      else
        await db.query(
          "UPDATE exchange_rates SET rate=$4::numeric WHERE country_code=$1 AND from_currency=$2 AND to_currency=$3",
          [...key, value.rate],
        );
    }
    const after = (await db.query(select, key)).rows[0];
    if (kind === "rates" && decimalText(after.rate) !== value.rate)
      throw deny(
        "La précision de la colonne rate ne permet pas ce taux exact. Aucun changement enregistré.",
        409,
      );
    await db.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$1,$2,$3)",
      [
        actor.id,
        kind === "fees"
          ? "FEE_RULE_" + mode.toUpperCase()
          : "EXCHANGE_RATE_" + mode.toUpperCase(),
        JSON.stringify({ reason, before: before || null, after }),
      ],
    );
    await queueActionNotice(db, {
      actorId: actor.id,
      subject: "Configuration financière CashPay mise à jour",
      message: `Une règle de ${kind === "fees" ? "frais" : "taux de change"} a été ${mode === "create" ? "ajoutée" : "modifiée"} dans CashPay Admin pour ${code}. Consultez l’historique des configurations pour les détails.`,
      action: kind === "fees" ? "FEE_RULE_CHANGE" : "EXCHANGE_RATE_CHANGE",
    });
    await db.query("COMMIT");
    return {
      success: true,
      row: kind === "fees" ? feeDTO(after) : rateDTO(after),
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (error.code === "23505")
      throw deny("Cette clé existe déjà. Actualisez la liste.", 409);
    throw error;
  } finally {
    db.release();
  }
}
export async function previewFee(pool, body) {
  const code = country(body.country_code),
    transactionType = type(body.transaction_type),
    cur = currency(body.currency),
    amount = engineNumber(body.amount);
  const info = feePolicy(transactionType, cur);
  const primary = info.globalOnly ? "GBL" : code;
  const candidates = [
    ...new Set([
      primary,
      "GBL",
      ...(policy.mobileWithdrawalTypes.includes(transactionType) &&
      ["USD", "EUR"].includes(cur)
        ? ["CD"]
        : []),
    ]),
  ];
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT ${feeColumns} FROM fee_structures WHERE transaction_type=$1 AND currency=$2 AND country_code=ANY($3::text[]) AND is_active=true`,
      [transactionType, cur, candidates],
    );
    let rule;
    for (const candidate of candidates) {
      const matches = rows.filter((row) => row.country_code === candidate);
      if (matches.length > 1) throw deny("Barème ambigu.", 409);
      if (matches[0]) {
        rule = matches[0];
        break;
      }
    }
    if (!rule)
      return {
        found: false,
        message:
          "Aucun barème actif pour ce code, cette devise et les replis applicables.",
      };
    let raw;
    try {
      raw = JSON.parse(rule.raw_tiers);
    } catch {
      throw deny("Format de barème invalide.", 409);
    }
    if (!Array.isArray(raw) || raw.some((t) => typeof t?.fee !== "string"))
      throw deny(
        "Format ancien non consommable par le moteur commun. Corrigez les paliers puis enregistrez.",
        409,
      );
    const tier =
      raw.find(
        (t) =>
          amount.number >= Number(t.min) &&
          (Number(t.max) === 0 || amount.number <= Number(t.max)),
      ) || raw.find((t) => Number(t.min) === 0 && Number(t.max) === 0);
    if (!tier)
      return {
        found: false,
        applied_country_code: rule.country_code,
        message: "Aucun palier applicable à ce montant.",
      };
    const percent = tier.fee.endsWith("%"),
      fee = engineNumber(percent ? tier.fee.slice(0, -1) : tier.fee);
    const {
      rows: [result],
    } = await db.query(
      "SELECT CASE WHEN $3::boolean THEN $1::numeric*$2::numeric/100 ELSE $2::numeric END::text AS fee",
      [amount.text, fee.text, percent],
    );
    return {
      found: true,
      applied_country_code: rule.country_code,
      transaction_type: transactionType,
      currency: cur,
      amount: amount.text,
      fee: decimalText(result.fee),
      policy: info,
    };
  });
}
export async function pricingHistory(pool, page) {
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      "SELECT i.id,i.action_type,i.created_at,i.detail,u.full_name AS actor_name FROM super_agent_interventions i LEFT JOIN users u ON u.id=i.admin_user_id WHERE i.action_type IN ('FEE_RULE_CREATE','FEE_RULE_UPDATE','EXCHANGE_RATE_CREATE','EXCHANGE_RATE_UPDATE') ORDER BY i.id DESC LIMIT 26 OFFSET $1",
      [page * 25],
    );
    return {
      rows: rows.slice(0, 25).map((row) => {
        let detail;
        try {
          detail = JSON.parse(row.detail);
        } catch {}
        return {
          id: row.id,
          action_type: row.action_type,
          created_at: row.created_at,
          actor_name: row.actor_name,
          reason: detail?.reason || "",
          country_code: detail?.after?.country_code,
          code:
            detail?.after?.transaction_type ||
            [detail?.after?.from_currency, detail?.after?.to_currency]
              .filter(Boolean)
              .join(" → "),
        };
      }),
      hasMore: rows.length > 25,
      page,
    };
  });
}
