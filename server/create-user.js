import { assertRegistrationScope } from "./staff-access.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import countries from "./registration-countries.json" with { type: "json" };
const fail = (message, status = 400) =>
  Object.assign(Error(message), { status, expose: true });
const clean = (body, key, max = 150, required = false) => {
  const value = body[key];
  if (value !== undefined && typeof value !== "string")
    throw fail("Champ invalide : " + key);
  const text = (value || "").trim();
  if ((required && !text) || text.length > max || /[\x00-\x1f]/.test(text))
    throw fail("Champ invalide : " + key);
  return text || null;
};
export function registrationCountries() {
  return countries;
}
export async function createUser(pool, actor, body, { media, sendWelcome }) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw fail("Formulaire invalide.");
  // Roles, balances and verification flags cannot be supplied by this endpoint.
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "first_name",
          "last_name",
          "middle_name",
          "email",
          "phone",
          "countryCode",
          "province",
          "city",
          "address",
          "birth_date",
          "nationality",
          "account_type",
          "pin",
          "pin_confirmation",
          "consent",
          "media",
          "id_type",
          "id_number",
          "id_issued_date",
          "id_expiry_date",
          "profession",
          "birth_place",
          "gender",
          "marital_status",
        ].includes(key),
    )
  )
    throw fail("Champ non autorisé.");
  if (body.consent !== true)
    throw fail("Confirmation du contrôle et de l’accord du titulaire requise.");
  const country = countries.find(
    (c) => c.code === clean(body, "countryCode", 2, true),
  );
  if (!country) throw fail("Pays invalide.");
  const first = clean(body, "first_name", 100, true),
    last = clean(body, "last_name", 100, true),
    middle = clean(body, "middle_name", 100);
  const email = clean(body, "email", 254, true)?.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw fail("Adresse e-mail invalide.");
  const phone = clean(body, "phone", 16, true);
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw fail("Téléphone requis au format international, par exemple +243…");
  const type = body.account_type || "national";
  if (!["national", "diaspora"].includes(type))
    throw fail("Type de compte invalide.");
  const birth = clean(body, "birth_date", 10, true),
    date = new Date(birth + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== birth ||
    date > new Date() ||
    date.getUTCFullYear() < 1900
  )
    throw fail("Date de naissance invalide.");
  const province = clean(body, "province"),
    city = clean(body, "city", 150, true),
    address = clean(body, "address", 500, true),
    nationality = clean(body, "nationality", 100, true);
  const rawPin =
    body.pin === undefined
      ? crypto.randomInt(1000, 10000).toString()
      : body.pin;
  if (
    typeof rawPin !== "string" ||
    !/^\d{4}$/.test(rawPin) ||
    (body.pin !== undefined && body.pin !== body.pin_confirmation)
  )
    throw fail("PIN initial invalide.");
  const documentType = clean(body, "id_type", 50, true),
    documentNumber = clean(body, "id_number", 100, true);
  if (
    ![
      "passport",
      "national_id",
      "voter_card",
      "driving_license",
      "residence_permit",
      "other",
    ].includes(documentType)
  )
    throw fail("Type de pièce invalide.");
  const mediaFiles = {};
  for (const purpose of ["avatar", "signature", "id_front"]) {
    if (typeof body.media?.[purpose] !== "string")
      throw fail("Photo, signature et pièce d’identité requises.");
    mediaFiles[purpose] = await media.resolve(
      actor,
      body.media[purpose],
      purpose,
    );
  }
  if (body.media?.id_back)
    mediaFiles.id_back = await media.resolve(
      actor,
      body.media.id_back,
      "id_back",
    );
  const issued = clean(body, "id_issued_date", 10),
    expiry = clean(body, "id_expiry_date", 10);
  for (const value of [issued, expiry])
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw fail("Date de pièce invalide.");
  const today = new Date().toISOString().slice(0, 10);
  if ((issued && issued > today) || (expiry && expiry < today))
    throw fail("La pièce est expirée ou sa date de délivrance est future.");
  if (issued && expiry && issued > expiry)
    throw fail("La date d’expiration précède la délivrance.");
  const profession = clean(body, "profession", 150),
    birthPlace = clean(body, "birth_place", 150),
    gender = clean(body, "gender", 10),
    marital = clean(body, "marital_status", 20);
  if (gender && !["male", "female", "other"].includes(gender))
    throw fail("Genre invalide.");
  if (
    marital &&
    !["single", "married", "divorced", "widowed"].includes(marital)
  )
    throw fail("État civil invalide.");
  const pinHash = await bcrypt.hash(rawPin, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ WRITE");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    const active = await client.query(
      "SELECT id,role::text AS role,country,province FROM users WHERE id=$1 AND role::text IN ('Admin','AccountManager') AND LOWER(TRIM(status::text))='active' FOR SHARE",
      [actor.id],
    );
    if (!active.rows.length) throw fail("Compte Admin actif requis.", 403);
    assertRegistrationScope(active.rows[0], country.name, province);
    // Serialize admin enrolments; constraints still protect against other application writers.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('cashpay-admin-create-user'))",
    );
    const duplicate = await client.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email))=$1 OR REGEXP_REPLACE(phone,'[^0-9]','','g')=$2 LIMIT 1",
      [email, phone.slice(1)],
    );
    if (duplicate.rows.length)
      throw fail(
        "Cet e-mail ou ce téléphone appartient déjà à un compte.",
        409,
      );
    const documentDuplicate = await client.query(
      "SELECT user_id FROM user_documents WHERE id_number=$1 LIMIT 1",
      [documentNumber],
    );
    if (documentDuplicate.rows.length)
      throw fail("Ce numéro de pièce est déjà enregistré.", 409);
    const prefix = country.code + "01";
    const sequence = await client.query(
      "SELECT COALESCE(MAX(SUBSTRING(id_wallet FROM 5)::bigint),0)::text AS last FROM users WHERE id_wallet ~ $1",
      ["^" + prefix + "[0-9]{8}$"],
    );
    const next = BigInt(sequence.rows[0].last) + 1n;
    if (next > 99999999n) throw fail("Plage de portefeuilles épuisée.", 409);
    const wallet = prefix + String(next).padStart(8, "0");
    const payload = {
      role: "Client",
      status: "Active",
      account_type: type,
      id_wallet: wallet,
      language: "fr",
      full_name: [first, last, middle].filter(Boolean).join(" ").toUpperCase(),
      first_name: first,
      last_name: last,
      middle_name: middle,
      birth_date: birth,
      nationality,
      email,
      phone,
      country: country.name,
      province,
      city,
      address,
      pin_hash: pinHash,
      availabilitystatus: "offline",
      is_crypto_active: false,
      profile_photo: mediaFiles.avatar.url,
      signature_image: mediaFiles.signature.url,
      profession,
      birth_place: birthPlace,
      gender,
      marital_status: marital,
    };
    const keys = Object.keys(payload);
    const result = await client.query(
      `INSERT INTO users (${keys.map((key) => '"' + key + '"').join(",")}) VALUES (${keys.map((_, index) => "$" + (index + 1)).join(",")}) RETURNING id,id_wallet,full_name,created_at`,
      Object.values(payload),
    );
    const user = result.rows[0],
      balances = { USD: 0, EUR: 0 };
    if (country.currency_code) balances[country.currency_code] = 0;
    await client.query(
      "INSERT INTO wallets (user_id,id_wallet,balances) VALUES ($1,$2,$3::jsonb)",
      [user.id, wallet, JSON.stringify(balances)],
    );
    await client.query(
      "INSERT INTO user_documents (user_id,id_type,id_number,id_issued_date,id_expiry_date,id_front_image,id_back_image) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        user.id,
        documentType,
        documentNumber,
        issued,
        expiry,
        mediaFiles.id_front.url,
        mediaFiles.id_back?.url || null,
      ],
    );
    const registration = {
      full_name: payload.full_name,
      id_wallet: wallet,
      email,
      phone,
      country: country.name,
      province,
      city,
      address,
      birth_date: birth,
      nationality,
      account_type: type,
      profile_photo: mediaFiles.avatar.url,
      created_at: user.created_at,
    };
    await client.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
      [
        actor.id,
        user.id,
        "ACCOUNT_CREATE",
        JSON.stringify({
          registration,
          media: body.media,
          document_type: documentType,
          consent_confirmed: true,
        }),
      ],
    );
    await client.query("COMMIT");
    let notifications;
    try {
      notifications = await sendWelcome({ ...registration, pin: rawPin });
    } catch {
      notifications = { email: "failed", sms: "failed", whatsapp: "failed" };
    }
    let notificationAudit = true;
    try {
      await client.query("BEGIN READ WRITE");
      await client.query(
        "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
        [actor.id, user.id, "ACCOUNT_WELCOME", JSON.stringify(notifications)],
      );
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      notificationAudit = false;
    }
    return { ...user, notifications, notificationAudit };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505")
      throw fail(
        "Ce compte existe déjà ou son identifiant vient d’être attribué. Recherchez le compte avant de réessayer.",
        409,
      );
    throw error;
  } finally {
    client.release();
  }
}
