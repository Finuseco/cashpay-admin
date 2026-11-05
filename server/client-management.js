import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { readSnapshot } from "./db.js";
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status, expose: true });
export const editableFields = [
  "first_name",
  "last_name",
  "middle_name",
  "email",
  "phone",
  "province",
  "city",
  "address",
  "nationality",
  "profession",
];
const version = (user) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify(editableFields.map((key) => [key, user[key] ?? null])) +
        String(user.role),
    )
    .digest("hex");
const pinFailures = new Map();
async function adminPin(db, actor, pin) {
  const now = Date.now();
  for (const [id, attempt] of pinFailures)
    if (attempt.until <= now) pinFailures.delete(id);
  const previous = pinFailures.get(actor.id);
  if (previous?.count >= 5)
    throw Object.assign(
      fail("Trop de PIN incorrects. Réessayez dans 15 minutes.", 429),
      { retryAfter: Math.ceil((previous.until - now) / 1000) },
    );
  if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin))
    throw fail("PIN administrateur requis.", 403);
  const { rows } = await db.query(
    "SELECT pin_hash FROM users WHERE id=$1 AND role::text='Admin' AND LOWER(TRIM(status::text))='active' FOR SHARE",
    [actor.id],
  );
  const hash = rows[0]?.pin_hash;
  const valid =
    typeof hash === "string" &&
    (/^\$2[aby]\$/.test(hash)
      ? await bcrypt.compare(pin, hash).catch(() => false)
      : /^\d{4,6}$/.test(hash) &&
        pin.length === hash.length &&
        crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(hash)));
  if (!valid) {
    const attempt = previous || { count: 0, until: now + 15 * 60000 };
    attempt.count++;
    pinFailures.set(actor.id, attempt);
    if (attempt.count >= 5)
      throw Object.assign(
        fail("Trop de PIN incorrects. Réessayez dans 15 minutes.", 429),
        { retryAfter: 900 },
      );
    throw fail("PIN administrateur incorrect.", 403);
  }
  pinFailures.delete(actor.id);
}
export async function managedClient(pool, id) {
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT id,id_wallet,role::text AS role,status::text AS status,${editableFields.join(",")} FROM users WHERE id=$1`,
      [id],
    );
    if (!rows[0]) throw fail("Compte introuvable.", 404);
    return { ...rows[0], version: version(rows[0]) };
  });
}
export async function updateClient(pool, actor, id, body) {
  if (
    !body ||
    typeof body !== "object" ||
    Object.keys(body).some(
      (key) => !["admin_pin", "reason", "version", "changes"].includes(key),
    )
  )
    throw fail("Modification invalide.");
  const changes = body.changes;
  if (
    !changes ||
    typeof changes !== "object" ||
    Array.isArray(changes) ||
    !Object.keys(changes).length ||
    Object.keys(changes).some((key) => !editableFields.includes(key))
  )
    throw fail("Champs modifiables invalides.");
  if (typeof body.reason !== "string")
    throw fail("Motif de modification requis.");
  const reason = body.reason.trim();
  if (reason.length < 10 || reason.length > 500)
    throw fail("Indiquez un motif de 10 à 500 caractères.");
  const values = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null && typeof value !== "string")
      throw fail("Valeur invalide.");
    values[key] = String(value || "").trim() || null;
    if (
      (values[key]?.length || 0) > (key === "address" ? 500 : 254) ||
      /[\x00-\x1f]/.test(values[key] || "")
    )
      throw fail("Champ invalide : " + key);
  }
  if ("email" in values) {
    values.email = values.email?.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email || ""))
      throw fail("Adresse e-mail invalide.");
  }
  if ("phone" in values && !/^\+[1-9]\d{7,14}$/.test(values.phone || ""))
    throw fail("Téléphone international invalide.");
  for (const key of [
    "first_name",
    "last_name",
    "city",
    "address",
    "nationality",
  ])
    if (key in values && !values[key]) throw fail("Champ requis : " + key);
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    await adminPin(db, actor, body.admin_pin);
    const { rows } = await db.query(
      `SELECT id,role::text AS role,${editableFields.join(",")} FROM users WHERE id=$1 FOR UPDATE`,
      [id],
    );
    const user = rows[0];
    if (!user || !["Client", "PartnerB2B"].includes(user.role))
      throw fail(
        "Modification réservée aux comptes clients et partenaires.",
        403,
      );
    if (body.version !== version(user))
      throw fail("La fiche a changé. Rechargez avant de modifier.", 409);
    const duplicate = await db.query(
      "SELECT id FROM users WHERE id<>$1 AND (($2::text IS NOT NULL AND LOWER(TRIM(email))=$2) OR ($3::text IS NOT NULL AND regexp_replace(phone,'[^0-9]','','g')=$3)) LIMIT 1",
      [id, values.email || null, values.phone?.slice(1) || null],
    );
    if (duplicate.rows.length) throw fail("Coordonnées déjà utilisées.", 409);
    const payload = { ...values };
    if (
      user.role === "Client" &&
      ["first_name", "last_name", "middle_name"].some((key) => key in values)
    )
      payload.full_name = [
        ...["first_name", "last_name", "middle_name"].map((key) =>
          key in values ? values[key] : user[key],
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toUpperCase();
    const keys = Object.keys(payload);
    await db.query(
      `UPDATE users SET ${keys.map((key, index) => '"' + key + '"=$' + (index + 2)).join(",")} WHERE id=$1`,
      [id, ...Object.values(payload)],
    );
    await db.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
      [
        actor.id,
        id,
        "CLIENT_UPDATE",
        JSON.stringify({
          reason,
          before: Object.fromEntries(
            Object.keys(values).map((key) => [key, user[key] ?? null]),
          ),
          after: values,
        }),
      ],
    );
    await db.query("COMMIT");
    return { success: true };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") throw fail("Coordonnées déjà utilisées.", 409);
    throw error;
  } finally {
    db.release();
  }
}
export async function upgradePartner(pool, actor, id, body) {
  const name =
    typeof body?.company_name === "string" ? body.company_name.trim() : "";
  if (name.length < 2 || name.length > 150 || /[\x00-\x1f]/.test(name))
    throw fail("Nom de société invalide.");
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    await adminPin(db, actor, body.admin_pin);
    const { rows } = await db.query(
      "SELECT role::text AS role,status::text AS status FROM users WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      rows[0]?.role !== "Client" ||
      String(rows[0].status).toLowerCase() !== "active"
    )
      throw fail("Seul un Client actif peut devenir partenaire.", 409);
    const apiKey = "cp_live_" + crypto.randomBytes(12).toString("hex"),
      apiSecret = "csk_live_" + crypto.randomBytes(24).toString("hex"),
      testKey = "cp_test_" + crypto.randomBytes(12).toString("hex"),
      testSecret = "csk_test_" + crypto.randomBytes(24).toString("hex");
    await db.query(
      "UPDATE users SET role='PartnerB2B',account_type='business',full_name=$2,api_key=$3,api_secret=$4,test_api_key=$5,test_api_secret=$6 WHERE id=$1",
      [id, name.toUpperCase(), apiKey, apiSecret, testKey, testSecret],
    );
    await db.query(
      "INSERT INTO b2b_partners (owner_user_id,company_name,company_email,status,api_key) SELECT id,$2,email,'active',$3 FROM users WHERE id=$1 ON CONFLICT (owner_user_id) DO UPDATE SET company_name=EXCLUDED.company_name,status='active',api_key=EXCLUDED.api_key",
      [id, name, apiKey],
    );
    await db.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
      [
        actor.id,
        id,
        "ROLE_UPGRADE_B2B",
        JSON.stringify({
          company_name: name,
          previous_role: "Client",
          role: "PartnerB2B",
        }),
      ],
    );
    await db.query("COMMIT");
    return { success: true };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
