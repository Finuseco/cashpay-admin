import { optionalSection } from "./db.js";
const moneyPattern = "^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$";
export async function financialOverview(
  db,
  { aliases, country, depositCodes },
) {
  const args = [JSON.stringify(aliases), country, depositCodes];
  const code = (alias) =>
    `COALESCE($1::jsonb->>LOWER(TRIM(${alias}.country)),NULLIF(UPPER(TRIM(${alias}.country)),''))`;
  const scope = `WITH scoped AS (SELECT t.*,${code("s")} AS sender_country,${code("r")} AS receiver_country FROM transactions t LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN users r ON r.id=t.receiver_id WHERE $2::text IS NULL OR ${code("s")}=$2 OR ${code("r")}=$2)`;
  const { rows: flows } = await db.query(
    `${scope} SELECT UPPER(TRIM(currency)) AS currency,type_code, status::text AS status,COUNT(*)::text AS count,COUNT(*)FILTER(WHERE amount IS NULL)::text AS unknown_amounts,COUNT(*)FILTER(WHERE fee IS NULL)::text AS unknown_fees,SUM(amount)::text AS amount,SUM(fee)::text AS fees FROM scoped GROUP BY UPPER(TRIM(currency)),type_code,status::text ORDER BY currency,type_code,status`,
    args.slice(0, 2),
  );
  const { rows: fees } = await db.query(
    `${scope} SELECT UPPER(TRIM(currency)) AS currency,COUNT(*)::text AS count,COUNT(*)FILTER(WHERE fee IS NULL)::text AS unknown_fees,SUM(fee)::text AS fees,SUM(fee)FILTER(WHERE created_at>=date_trunc('month',NOW()))::text AS month_fees FROM scoped WHERE LOWER(status::text)='completed' GROUP BY UPPER(TRIM(currency)) ORDER BY currency`,
    args.slice(0, 2),
  );
  const { rows: monthly } = await db.query(
    `${scope} SELECT to_char(created_at,'YYYY-MM') AS month,UPPER(TRIM(currency)) AS currency,SUM(fee)::text AS fees,COUNT(*)FILTER(WHERE fee IS NULL)::text AS unknown_fees FROM scoped WHERE LOWER(status::text)='completed' AND created_at>=date_trunc('month',NOW())-INTERVAL '11 months' GROUP BY to_char(created_at,'YYYY-MM'),UPPER(TRIM(currency)) ORDER BY month,currency`,
    args.slice(0, 2),
  );
  const { rows: corridors } = await db.query(
    `${scope} SELECT sender_country,receiver_country,UPPER(TRIM(currency)) AS currency,COUNT(*)::text AS count,COUNT(*)FILTER(WHERE amount IS NULL)::text AS unknown_amounts,COUNT(*)FILTER(WHERE fee IS NULL)::text AS unknown_fees,SUM(amount)::text AS amount,SUM(fee)::text AS fees FROM scoped WHERE LOWER(status::text)='completed' AND sender_country IS NOT NULL AND receiver_country IS NOT NULL AND sender_country<>receiver_country GROUP BY sender_country,receiver_country,UPPER(TRIM(currency)) ORDER BY count DESC,sender_country,receiver_country,currency`,
    args.slice(0, 2),
  );
  const { rows: recent } = await db.query(
    `${scope} SELECT id,reference_code,type_code,status::text AS status,amount::text AS amount,currency,fee::text AS fee,sender_id,receiver_id,sender_country,receiver_country,created_at FROM scoped ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 50`,
    args.slice(0, 2),
  );
  const crypto = await optionalSection(
    db,
    async () =>
      (
        await db.query(
          `SELECT UPPER(TRIM(b.currency_code)) AS currency,SUM(b.balance)::text AS amount,COUNT(*)::text AS accounts,COUNT(*)FILTER(WHERE b.balance IS NULL)::text AS invalid_entries FROM user_crypto_balances b JOIN users u ON u.id=b.user_id WHERE $2::text IS NULL OR ${code("u")}=$2 GROUP BY UPPER(TRIM(b.currency_code)) ORDER BY currency`,
          args.slice(0, 2),
        )
      ).rows,
  );
  const commissions = await optionalSection(
    db,
    async () =>
      (
        await db.query(
          `WITH raw AS (SELECT w.user_id,w.commission_balance::jsonb AS balances FROM wallets w JOIN users u ON u.id=w.user_id WHERE $2::text IS NULL OR ${code("u")}=$2),entries AS (SELECT user_id,b.key,b.value FROM raw CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(balances)='object' THEN balances ELSE '{}'::jsonb END)b) SELECT UPPER(TRIM(key)) AS currency,SUM(CASE WHEN value~$3 THEN value::numeric END)::text AS amount,COUNT(*)FILTER(WHERE (value~$3) IS NOT TRUE)::text AS invalid_entries FROM entries GROUP BY UPPER(TRIM(key)) ORDER BY currency`,
          [...args.slice(0, 2), moneyPattern],
        )
      ).rows,
  );
  const revenueRegistry = await optionalSection(
    db,
    async () =>
      (
        await db.query(
          "SELECT wallet_id::text AS wallet_id,country_code::text AS country,revenue_type::text AS purpose,is_active FROM revenue_wallets WHERE $1::text IS NULL OR UPPER(TRIM(country_code))=$1 OR UPPER(TRIM(country_code))='GBL'",
          [country],
        )
      ).rows,
  );
  const floatRegistry = await optionalSection(
    db,
    async () =>
      (
        await db.query(
          `SELECT p.float_wallet_id::text AS wallet_id,p.id::text AS partner_id,p.status::text AS status,${code("u")} AS country FROM b2b_partners p LEFT JOIN users u ON u.id=p.owner_user_id WHERE $2::text IS NULL OR ${code("u")}=$2`,
          args.slice(0, 2),
        )
      ).rows,
  );
  const references = new Map();
  for (const [source, registry] of [
    ["Revenus", revenueRegistry],
    ["Flotte B2B", floatRegistry],
  ])
    for (const row of registry.rows) {
      const id = String(row.wallet_id || "").trim();
      if (!id) continue;
      const current = references.get(id) || { wallet_id: id, sources: [] };
      current.sources.push({
        source,
        country: row.country,
        purpose: row.purpose || null,
        status: row.status ?? (row.is_active ? "Actif" : "Inactif"),
      });
      references.set(id, current);
    }
  let accounts = [],
    totals = [];
  if (references.size) {
    const ids = [...references.keys()];
    const { rows } = await db.query(
      "SELECT id_wallet,user_id,balances::jsonb AS balances FROM wallets WHERE id_wallet=ANY($1::text[])",
      [ids],
    );
    const found = new Map(rows.map((row) => [row.id_wallet, row]));
    // Parse each JSON balance as text in PostgreSQL to preserve every decimal digit.
    const { rows: entries } = await db.query(
      `SELECT w.id_wallet,UPPER(TRIM(b.key)) AS currency,b.value AS amount,CASE WHEN b.value~$2 THEN true ELSE false END AS valid FROM wallets w CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(w.balances::jsonb)='object' THEN w.balances::jsonb ELSE '{}'::jsonb END)b WHERE w.id_wallet=ANY($1::text[]) ORDER BY w.id_wallet,b.key`,
      [ids, moneyPattern],
    );
    accounts = ids.map((id) => {
      const row = found.get(id);
      return {
        ...references.get(id),
        user_id: row?.user_id || null,
        error: !row
          ? "Portefeuille introuvable"
          : !row.balances ||
              Array.isArray(row.balances) ||
              typeof row.balances !== "object"
            ? "Format de solde invalide"
            : null,
        balances: entries
          .filter((entry) => entry.id_wallet === id)
          .map(({ currency, amount, valid }) => ({ currency, amount, valid })),
      };
    });
    const result = await db.query(
      `SELECT UPPER(TRIM(b.key)) AS currency,SUM(CASE WHEN b.value~$2 THEN b.value::numeric END)::text AS amount,COUNT(*)FILTER(WHERE (b.value~$2) IS NOT TRUE)::text AS invalid_entries FROM wallets w CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(w.balances::jsonb)='object' THEN w.balances::jsonb ELSE '{}'::jsonb END)b WHERE w.id_wallet=ANY($1::text[]) GROUP BY UPPER(TRIM(b.key)) ORDER BY currency`,
      [ids, moneyPattern],
    );
    totals = result.rows;
  }
  const rates = await optionalSection(
    db,
    async () =>
      (
        await db.query(
          "SELECT DISTINCT ON (from_currency,to_currency) country_code,from_currency,to_currency,rate::text AS rate FROM exchange_rates WHERE country_code=ANY($1::text[]) AND rate>0 ORDER BY from_currency,to_currency,(country_code=$2) DESC,rate",
          [[...new Set([country || "GBL", "GBL"])], country || "GBL"],
        )
      ).rows,
  );
  const { rows: mirrors } = await db.query(
    `${scope},fee_totals AS (SELECT UPPER(TRIM(currency)) AS currency,SUM(fee) AS fees,COUNT(*)FILTER(WHERE fee IS NULL)::text AS unknown_fees FROM scoped WHERE LOWER(status::text)='completed' GROUP BY UPPER(TRIM(currency))),rates AS (SELECT * FROM jsonb_to_recordset($3::jsonb) AS r(from_currency text,to_currency text,rate numeric)),targets AS (SELECT unnest(ARRAY['USD','EUR']) AS currency) SELECT f.currency AS source_currency,targets.currency AS target_currency,f.fees::text AS source_amount,f.unknown_fees,CASE WHEN f.currency=targets.currency THEN '1' ELSE rates.rate::text END AS rate,CASE WHEN f.currency=targets.currency THEN f.fees ELSE f.fees*rates.rate END::text AS amount FROM fee_totals f CROSS JOIN targets LEFT JOIN rates ON rates.from_currency=f.currency AND rates.to_currency=targets.currency ORDER BY source_currency,target_currency`,
    [...args.slice(0, 2), JSON.stringify(rates.rows)],
  );
  return {
    flows,
    fees,
    mirrors,
    monthly,
    corridors,
    recent,
    crypto,
    commissions,
    treasury: {
      accounts,
      totals,
      revenueRegistry: {
        available: revenueRegistry.available,
        error: revenueRegistry.error,
      },
      floatRegistry: {
        available: floatRegistry.available,
        error: floatRegistry.error,
      },
    },
    rates,
    definitions: {
      fees: "Frais bruts inscrits dans transactions.fee sur les opérations Completed. Aucun bénéfice net ni revenu encaissé garanti.",
      treasury:
        "Soldes internes des portefeuilles référencés ; un même portefeuille est compté une fois. Ce ne sont pas des soldes bancaires ou blockchain vérifiés.",
      crypto:
        "Registre user_crypto_balances, séparé de wallets.balances pour éviter un double comptage.",
      scope:
        "Pays déclaré de l’émetteur ou du bénéficiaire. Les comptes globaux GBL restent visibles.",
      depositCodes,
    },
  };
}
