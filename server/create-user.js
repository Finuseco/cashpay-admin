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
export async function createUser(pool, actor, body) {
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
        ].includes(key),
    )
  )
    throw fail("Champ non autorisé.");
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
  if (
    typeof body.pin !== "string" ||
    !/^\d{4}$/.test(body.pin) ||
    body.pin !== body.pin_confirmation
  )
    throw fail(
      "Le PIN initial doit contenir quatre chiffres identiques dans les deux champs.",
    );
  const pinHash = await bcrypt.hash(body.pin, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ WRITE");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    const active = await client.query(
      "SELECT id FROM users WHERE id=$1 AND role::text='Admin' AND LOWER(TRIM(status::text))='active' FOR SHARE",
      [actor.id],
    );
    if (!active.rows.length) throw fail("Compte Admin actif requis.", 403);
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
    const prefix = country.code + "01";
    const sequence = await client.query(
      "SELECT COALESCE(MAX(SUBSTRING(id_wallet FROM 5)::bigint),0)::text AS last FROM users WHERE id_wallet ~ $1",
      ["^" + prefix + "[0-9]{8}$"],
    );
    const next = BigInt(sequence.rows[0].last) + 1n;
    if (next > 99999999n) throw fail("Plage de portefeuilles épuisée.", 409);
    const wallet = prefix + String(next).padStart(8, "0");
    const result = await client.query(
      `INSERT INTO users (role,status,account_type,id_wallet,language,full_name,first_name,last_name,middle_name,birth_date,nationality,email,phone,country,province,city,address,pin_hash,availabilitystatus,is_crypto_active) VALUES ('Client','Active',$1,$2,'fr',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'offline',false) RETURNING id,id_wallet,full_name`,
      [
        type,
        wallet,
        [first, last, middle].filter(Boolean).join(" ").toUpperCase(),
        first,
        last,
        middle,
        birth,
        nationality,
        email,
        phone,
        country.name,
        province,
        city,
        address,
        pinHash,
      ],
    );
    const user = result.rows[0],
      balances = { USD: 0, EUR: 0 };
    if (country.currency_code) balances[country.currency_code] = 0;
    await client.query(
      "INSERT INTO wallets (user_id,id_wallet,balances) VALUES ($1,$2,$3::jsonb)",
      [user.id, wallet, JSON.stringify(balances)],
    );
    // No fabricated document or automatic KYC verification is created.
    await client.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
      [
        actor.id,
        user.id,
        "ACCOUNT_CREATE",
        "Création de compte Client depuis Cashpay Admin",
      ],
    );
    await client.query("COMMIT");
    return user;
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
