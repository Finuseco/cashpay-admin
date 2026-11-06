import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { verifyCustomerConsent } from "./customer-consent.js";
import { readSnapshot } from "./db.js";
import { adminPin } from "./client-management.js";
import { assertClientScope, deny } from "./staff-access.js";
function product(body) {
  if (
    !["visa", "mastercard"].includes(body?.brand) ||
    !["USD", "EUR"].includes(body?.currency) ||
    body.card_type !== "physique"
  )
    throw deny(
      "Produit non disponible. Seules les commandes physiques Visa/Mastercard USD/EUR sont disponibles.",
      400,
    );
  return {
    brand: body.brand,
    currency: body.currency,
    card_type: "physique",
    code: `BUY_CARDS_${body.currency}_P_FEE`,
  };
}
async function price(db, p, lock = false) {
  const { rows } = await db.query(
    "SELECT fee_tiers FROM fee_structures WHERE transaction_type=$1 AND currency=$2 AND country_code=$3 AND is_active=true" +
      (lock ? " FOR SHARE" : ""),
    [p.code, p.currency, "GBL"],
  );
  if (rows.length !== 1)
    throw deny(
      "Tarif carte absent ou ambigu. Aucune commande ni aucun débit.",
      503,
    );
  let tiers = rows[0].fee_tiers;
  if (typeof tiers === "string") {
    try {
      tiers = JSON.parse(tiers);
    } catch {
      throw deny("Tarif carte invalide.", 503);
    }
  }
  if (!Array.isArray(tiers)) throw deny("Tarif carte invalide.", 503);
  const tier =
    tiers.find(
      (t) => Number(t.min) <= 1 && (Number(t.max) === 0 || Number(t.max) >= 1),
    ) || tiers.find((t) => Number(t.min) === 0 && Number(t.max) === 0);
  if (
    !tier ||
    typeof tier.fee !== "string" ||
    !/^\d+(?:\.\d+)?%?$/.test(tier.fee)
  )
    throw deny(
      "Palier tarifaire invalide. Aucune commande ni aucun débit.",
      503,
    );
  const percentage = tier.fee.endsWith("%");
  const {
    rows: [result],
  } = await db.query("SELECT ($1::numeric / $2::numeric)::text AS amount", [
    percentage ? tier.fee.slice(0, -1) : tier.fee,
    percentage ? "100" : "1",
  ]);
  return result.amount.includes(".")
    ? result.amount.replace(/0+$/, "").replace(/\.$/, "")
    : result.amount;
}
export async function quoteCard(pool, actor, id, body, config) {
  const p = product(body);
  return readSnapshot(pool, async (db) => {
    await assertClientScope(db, actor, id);
    const amount = await price(db, p);
    const nonce = crypto.randomUUID();
    return {
      product: { ...p, price: amount },
      quote: jwt.sign(
        { actor: Number(actor.id), target: id, ...p, price: amount },
        config.secret,
        {
          issuer: "cashpay-assisted-card",
          audience: config.origin,
          expiresIn: 600,
          jwtid: nonce,
        },
      ),
      expiresIn: 600,
    };
  });
}
export async function orderAssistedCard(
  pool,
  actor,
  id,
  body,
  config,
  sendReceipt,
) {
  if (body?.consent !== true)
    throw deny("Consentement explicite du titulaire requis.", 400);
  let quote;
  try {
    quote = jwt.verify(body.quote, config.secret, {
      algorithms: ["HS256"],
      issuer: "cashpay-assisted-card",
      audience: config.origin,
    });
  } catch {
    throw deny("Devis expiré ou invalide. Actualisez le tarif.", 409);
  }
  if (quote.actor !== Number(actor.id) || quote.target !== id) throw deny();
  const p = product(quote),
    db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    const freshActor = await adminPin(db, actor, body.staff_pin);
    await assertClientScope(db, freshActor, id);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [quote.jti]);
    const duplicate = await db.query(
      "SELECT id FROM transactions WHERE metadata->>'assisted_quote_id'=$1 LIMIT 1",
      [quote.jti],
    );
    if (duplicate.rows.length)
      throw deny(
        "Cette commande a déjà été enregistrée. Actualisez la liste.",
        409,
      );
    const amount = await price(db, p, true);
    const {
      rows: [same],
    } = await db.query("SELECT $1::numeric=$2::numeric AS same", [
      amount,
      quote.price,
    ]);
    if (!same.same)
      throw deny("Le tarif a changé. Un nouveau consentement est requis.", 409);
    const { rows } = await db.query(
      "SELECT id,id_wallet,full_name,email,phone,pin_hash,status::text AS status,role::text AS role FROM users WHERE id=$1 FOR UPDATE",
      [id],
    );
    const target = rows[0];
    await assertClientScope(db, freshActor, id);
    if (
      !target ||
      !["Client", "PartnerB2B"].includes(target.role) ||
      String(target.status).toLowerCase() !== "active"
    )
      throw deny("Titulaire non disponible.", 409);
    await verifyCustomerConsent(target.pin_hash, body.customer_pin, id);
    const wallet = await db.query(
      "SELECT balances FROM wallets WHERE user_id=$1 FOR UPDATE",
      [id],
    );
    if (!wallet.rows.length)
      throw deny("Portefeuille indisponible. Aucun débit.", 409);
    const check = await db.query(
      "SELECT CASE WHEN jsonb_typeof(balances::jsonb)='object' AND COALESCE(balances::jsonb->>$2,'0') ~ '^[0-9]+([.][0-9]+)?$' THEN COALESCE((balances::jsonb->>$2)::numeric,0)>=$3::numeric ELSE false END AS sufficient FROM wallets WHERE user_id=$1",
      [id, p.currency, amount],
    );
    if (!check.rows[0].sufficient)
      throw deny("Fonds insuffisants pour cette commande. Aucun débit.", 409);
    const {
      rows: [request],
    } = await db.query(
      "INSERT INTO card_requests (user_id,card_type,brand,currency,status) VALUES ($1,'physique',$2,$3,'pending') RETURNING id",
      [id, p.brand, p.currency],
    );
    await db.query(
      "UPDATE wallets SET balances=jsonb_set(balances::jsonb,ARRAY[$2::text],to_jsonb(COALESCE((balances::jsonb->>$2)::numeric,0)-$3::numeric),true) WHERE user_id=$1",
      [id, p.currency, amount],
    );
    const reference =
      p.code.substring(0, 4).toUpperCase() +
      "-" +
      Date.now().toString(36).slice(-6).toUpperCase() +
      crypto
        .randomInt(0, 36 ** 4)
        .toString(36)
        .padStart(4, "0")
        .toUpperCase();
    await db.query(
      "INSERT INTO transactions (reference_code,type_code,status,amount,currency,fee,description,sender_id,sender_wallet_id,metadata) VALUES ($1,$2,'Completed',$3::numeric,$4,0,$5,$6,$7,$8::jsonb)",
      [
        reference,
        p.code,
        amount,
        p.currency,
        "Commande carte physique assistée " + p.brand,
        id,
        target.id_wallet,
        JSON.stringify({
          facilitator: actor.id,
          card_request_id: request.id,
          assisted_quote_id: quote.jti,
          consent_method: "customer_pin",
          consent_verified_at: new Date().toISOString(),
        }),
      ],
    );
    await db.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
      [
        actor.id,
        id,
        "CARD_ORDER",
        JSON.stringify({
          request_id: request.id,
          reference,
          brand: p.brand,
          currency: p.currency,
          price: amount,
          consent: "customer_pin",
          status: "pending",
        }),
      ],
    );
    await db.query("COMMIT");
    let notifications;
    try {
      notifications = await sendReceipt({
        email: target.email,
        phone: target.phone,
        full_name: target.full_name,
        id_wallet: target.id_wallet,
        price: amount,
        currency: p.currency,
        brand: p.brand,
        reference,
        request_id: request.id,
      });
    } catch {
      notifications = { email: "failed", sms: "failed", whatsapp: "failed" };
    }
    let notificationAudit = true;
    try {
      await db.query("BEGIN READ WRITE");
      await db.query(
        "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
        [
          actor.id,
          id,
          "CARD_ORDER_NOTIFICATION",
          JSON.stringify(notifications),
        ],
      );
      await db.query("COMMIT");
    } catch {
      await db.query("ROLLBACK").catch(() => {});
      notificationAudit = false;
    }
    return {
      notifications,
      notificationAudit,
      success: true,
      request_id: request.id,
      reference,
      status: "pending",
      price: amount,
      currency: p.currency,
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
