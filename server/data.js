import countries from "./countries.json" with { type: "json" };
import { readSnapshot, optionalSection } from "./db.js";
export const depositCodes = [
  "DP",
  "DP_AGENT",
  "DP_SUPER_AGENT",
  "DP_CRYPTO",
  "DP_CARD",
  "DP_PAYPAL",
];
const aliases = Object.fromEntries(
  countries.flatMap((country) => [
    [country.code.toLowerCase(), country.code],
    [country.name.toLowerCase().trim(), country.code],
  ]),
);
const countryNames = Object.fromEntries(
  countries.map((country) => [country.code, country.name]),
);
const countrySql =
  "COALESCE($1::jsonb->>LOWER(TRIM(u.country)),NULLIF(UPPER(TRIM(u.country)),''))";
const common = `WITH selected_users AS (SELECT u.id,u.full_name,u.status::text AS status,u.created_at,${countrySql} AS country FROM users u WHERE ($2::text IS NULL OR ${countrySql}=$2)),
 deposits AS (SELECT t.id,t.amount,t.currency,t.created_at,CASE WHEN t.type_code IN ('DP_AGENT','DP_SUPER_AGENT') THEN t.receiver_id ELSE COALESCE(t.sender_id,t.receiver_id) END AS owner_id FROM transactions t WHERE t.type_code=ANY($3::text[]) AND LOWER(t.status::text)='completed' AND t.amount>0),
 first_deposits AS (SELECT d.owner_id,MIN(d.created_at) AS first_at FROM deposits d JOIN selected_users u ON u.id=d.owner_id GROUP BY d.owner_id)`;
const balanceCommon = `WITH selected_users AS (SELECT u.id FROM users u WHERE ($2::text IS NULL OR ${countrySql}=$2)),
 wallet_data AS (SELECT w.user_id,COALESCE(w.balances::jsonb,'{}'::jsonb) AS balances FROM wallets w JOIN selected_users u ON u.id=w.user_id),
 entries AS (SELECT w.user_id,UPPER(TRIM(b.key)) AS currency,b.value,
 CASE WHEN b.value~'^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' THEN b.value::numeric ELSE NULL END AS amount
 FROM wallet_data w CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(w.balances)='object' THEN w.balances ELSE '{}'::jsonb END)b)`;
function parameters(country) {
  return [JSON.stringify(aliases), country || null, depositCodes];
}
export function validateCountry(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 100 || !value.trim())
    throw Object.assign(Error("Pays invalide."), { status: 400 });
  return aliases[value.trim().toLowerCase()] || value.trim().toUpperCase();
}
export function avatarUrl(value, origin) {
  if (!value || typeof value !== "string") return null;
  try {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export async function dashboard(pool, country) {
  return readSnapshot(pool, async (db) => {
    const args = parameters(country);
    const {
      rows: [counts],
    } = await db.query(
      `${common} SELECT COUNT(*)::text AS users,COUNT(*) FILTER(WHERE LOWER(status)='active')::text AS active_users,COUNT(DISTINCT country)::text AS represented_countries,COUNT(DISTINCT country)FILTER(WHERE LOWER(status)='active')::text AS active_countries,COUNT(*)FILTER(WHERE f.owner_id IS NOT NULL)::text AS with_deposit,COUNT(*)FILTER(WHERE f.owner_id IS NULL)::text AS without_deposit FROM selected_users u LEFT JOIN first_deposits f ON f.owner_id=u.id`,
      args,
    );
    const { rows: byCountry } = await db.query(
      `${common} SELECT u.country,COUNT(*)::text AS users,COUNT(*)FILTER(WHERE LOWER(u.status)='active')::text AS active_users,COUNT(*)FILTER(WHERE f.owner_id IS NOT NULL)::text AS with_deposit FROM selected_users u LEFT JOIN first_deposits f ON f.owner_id=u.id GROUP BY u.country ORDER BY COUNT(*) DESC,u.country`,
      args,
    );
    const { rows: balances } = await db.query(
      `${balanceCommon} SELECT currency,COALESCE(SUM(amount),0)::text AS amount,COUNT(DISTINCT user_id)FILTER(WHERE amount<>0)::text AS funded_users,COUNT(*)FILTER(WHERE amount IS NULL)::text AS invalid_entries FROM entries GROUP BY currency HAVING BOOL_OR(amount<>0) OR COUNT(*)FILTER(WHERE amount IS NULL)>0 ORDER BY currency`,
      args.slice(0, 2),
    );
    const {
      rows: [quality],
    } = await db.query(
      `${balanceCommon} SELECT COUNT(*)FILTER(WHERE jsonb_typeof(balances)<>'object')::text AS invalid_wallets FROM wallet_data`,
      args.slice(0, 2),
    );
    const { rows: monthly } = await db.query(
      `${common},months AS (SELECT generate_series(date_trunc('month',NOW())-INTERVAL '11 months',date_trunc('month',NOW()),INTERVAL '1 month') AS month) SELECT to_char(m.month,'YYYY-MM') AS month,(SELECT COUNT(*)::text FROM selected_users u WHERE u.created_at>=m.month AND u.created_at<m.month+INTERVAL '1 month') AS registrations,(SELECT COUNT(*)::text FROM first_deposits f WHERE f.first_at>=m.month AND f.first_at<m.month+INTERVAL '1 month') AS first_depositors FROM months m ORDER BY m.month`,
      args,
    );
    const { rows: volumes } = await db.query(
      `${common} SELECT to_char(d.created_at,'YYYY-MM') AS month,UPPER(d.currency) AS currency,SUM(d.amount)::text AS amount,COUNT(*)::text AS count FROM deposits d JOIN selected_users u ON u.id=d.owner_id WHERE d.created_at>=date_trunc('month',NOW())-INTERVAL '11 months' GROUP BY to_char(d.created_at,'YYYY-MM'),UPPER(d.currency) ORDER BY month,currency`,
      args,
    );
    const cards = await optionalSection(
      db,
      async () =>
        (
          await db.query(
            `SELECT cr.status::text AS status,COUNT(*)::text AS count FROM card_requests cr JOIN users u ON u.id=cr.user_id WHERE ($2::text IS NULL OR ${countrySql}=$2) GROUP BY cr.status ORDER BY cr.status`,
            args.slice(0, 2),
          )
        ).rows,
    );
    const orders = await optionalSection(
      db,
      async () =>
        (
          await db.query(
            `SELECT o.status::text AS status,COUNT(*)::text AS count FROM orders o JOIN users u ON u.id=o.user_id WHERE ($2::text IS NULL OR ${countrySql}=$2) GROUP BY o.status ORDER BY o.status`,
            args.slice(0, 2),
          )
        ).rows,
    );
    const {
      rows: [clock],
    } = await db.query("SELECT transaction_timestamp() AS at");
    return {
      snapshotAt: clock.at,
      country,
      counts,
      balances,
      balanceQuality: quality,
      countries: byCountry.map((row) => ({
        ...row,
        name: countryNames[row.country] || row.country || "Non renseigné",
      })),
      monthly,
      depositVolumes: volumes,
      cards,
      orders,
      definitions: {
        depositCodes,
        depositStatus: "Completed",
        depositOwner:
          "DP_AGENT et DP_SUPER_AGENT : receiver_id ; autres dépôts : titulaire sender_id.",
        volume:
          "Montant et devise de l’écriture du registre, sans conversion ni addition de devises.",
        countries:
          "Pays déclarés normalisés par le référentiel Cashpay Web ; pays actifs = au moins un compte actif.",
      },
    };
  });
}
export function pageNumber(value) {
  const n = Number(value || 0);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000)
    throw Object.assign(Error("Page invalide."), { status: 400 });
  return n;
}
export function userId(value) {
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647)
    throw Object.assign(Error("Identifiant utilisateur invalide."), {
      status: 400,
    });
  return Number(value);
}
export async function findUsers(
  pool,
  { search = "", country = null, page = 0 },
  mediaOrigin,
) {
  return readSnapshot(pool, async (db) => {
    if (typeof search !== "string" || search.length > 100)
      throw Object.assign(Error("Recherche limitée à 100 caractères."), {
        status: 400,
      });
    const literal = search.trim().replace(/[\\%_]/g, "\\$&"),
      digits = search.replace(/\D/g, "");
    const args = [
      JSON.stringify(aliases),
      country,
      `%${literal}%`,
      literal ? digits.slice(-9) : "",
      page * 25,
    ];
    const where = `($2::text IS NULL OR ${countrySql}=$2) AND ($3='%%' OR u.full_name ILIKE $3 OR u.email ILIKE $3 OR u.id_wallet ILIKE $3 OR u.phone ILIKE $3 OR ($4<>'' AND RIGHT(regexp_replace(COALESCE(u.phone,''),'[^0-9]','','g'),9)=$4))`;
    const { rows } = await db.query(
      `SELECT u.id,u.full_name,u.id_wallet,u.phone,u.email,u.country,u.role::text AS role,u.status::text AS status,u.profile_photo,u.created_at FROM users u WHERE ${where} ORDER BY u.created_at DESC NULLS LAST,u.id DESC LIMIT 26 OFFSET $5`,
      args,
    );
    return {
      users: rows
        .slice(0, 25)
        .map((row) => ({
          ...row,
          profile_photo: avatarUrl(row.profile_photo, mediaOrigin),
        })),
      page,
      hasMore: rows.length > 25,
    };
  });
}
export async function userProfile(pool, id, mediaOrigin) {
  return readSnapshot(pool, async (db) => {
    const {
      rows: [user],
    } = await db.query(
      "SELECT id,full_name,id_wallet,phone,email,country,province,city,role::text AS role,status::text AS status,profile_photo,created_at FROM users WHERE id=$1",
      [id],
    );
    if (!user)
      throw Object.assign(Error("Utilisateur introuvable."), { status: 404 });
    const { rows: balances } = await db.query(
      `SELECT UPPER(TRIM(b.key)) AS currency,b.value AS amount FROM wallets w CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(COALESCE(w.balances::jsonb,'{}'::jsonb))='object' THEN COALESCE(w.balances::jsonb,'{}'::jsonb) ELSE '{}'::jsonb END)b WHERE w.user_id=$1 ORDER BY b.key`,
      [id],
    );
    const {
      rows: [walletQuality],
    } = await db.query(
      "SELECT COUNT(*)::text AS wallets,COUNT(*)FILTER(WHERE jsonb_typeof(COALESCE(balances::jsonb,'{}'::jsonb))<>'object')::text AS invalid_wallets FROM wallets WHERE user_id=$1",
      [id],
    );
    const { rows: deposits } = await db.query(
      "SELECT UPPER(currency) AS currency,SUM(amount)::text AS amount,COUNT(*)::text AS count FROM transactions WHERE type_code=ANY($2::text[]) AND LOWER(status::text)='completed' AND amount>0 AND CASE WHEN type_code IN ('DP_AGENT','DP_SUPER_AGENT') THEN receiver_id ELSE COALESCE(sender_id,receiver_id) END=$1 GROUP BY UPPER(currency) ORDER BY currency",
      [id, depositCodes],
    );
    return {
      user: {
        ...user,
        profile_photo: avatarUrl(user.profile_photo, mediaOrigin),
      },
      balances,
      walletQuality,
      deposits,
    };
  });
}
export async function activity(pool, id, kind, page) {
  return readSnapshot(pool, async (db) => {
    const { rows: exists } = await db.query(
      "SELECT id FROM users WHERE id=$1",
      [id],
    );
    if (!exists.length)
      throw Object.assign(Error("Utilisateur introuvable."), { status: 404 });
    let result;
    if (kind === "transactions")
      result = {
        available: true,
        rows: (
          await db.query(
            "SELECT id,reference_code,type_code,status::text AS status,amount::text AS amount,currency,fee::text AS fee,description,sender_id,receiver_id,created_at FROM transactions WHERE sender_id=$1 OR receiver_id=$1 ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET $2",
            [id, page * 25],
          )
        ).rows,
      };
    else if (kind === "cards")
      result = await optionalSection(
        db,
        async () =>
          (
            await db.query(
              "SELECT id,status::text AS status,to_jsonb(cr)->>'card_type' AS card_type,to_jsonb(cr)->>'brand' AS brand,created_at FROM card_requests cr WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET $2",
              [id, page * 25],
            )
          ).rows,
      );
    else if (kind === "orders")
      result = await optionalSection(
        db,
        async () =>
          (
            await db.query(
              "SELECT id,reference,status::text AS status,total_amount::text AS amount,currency,created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 26 OFFSET $2",
              [id, page * 25],
            )
          ).rows,
      );
    else throw Object.assign(Error("Section inconnue."), { status: 400 });
    return {
      ...result,
      rows: result.rows.slice(0, 25),
      hasMore: result.rows.length > 25,
      page,
    };
  });
}
