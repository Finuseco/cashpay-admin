import { clientFilter, deny } from "./staff-access.js";
import { readSnapshot, optionalSection } from "./db.js";
const fail = (message) =>
  Object.assign(Error(message), { status: 400, expose: true });
export async function operations(
  pool,
  kind,
  { page = 0, search = "", status = "" },
  actor = { role: "Admin" },
) {
  if (
    !["transactions", "cards", "orders", "registrations"].includes(kind) ||
    typeof search !== "string" ||
    search.length > 100 ||
    typeof status !== "string" ||
    status.length > 50
  )
    throw fail("Recherche invalide.");
  if (
    actor.role === "AccountManager" &&
    !["cards", "registrations"].includes(kind)
  )
    throw deny();
  const access = clientFilter(actor, "u", kind === "registrations" ? 5 : 4);
  const args = [
    "%" + search.trim().replace(/[\\%_]/g, "\\$&") + "%",
    status || null,
    page * 25,
  ];
  if (kind === "cards") args.push(...access.values);
  if (kind === "registrations") args.push(actor.id || null, ...access.values);
  return readSnapshot(pool, async (db) => {
    const result = await optionalSection(db, async () => {
      if (kind === "transactions")
        return (
          await db.query(
            "SELECT t.id,t.reference_code AS reference,t.type_code,t.status::text AS status,t.amount::text AS amount,t.currency,t.fee::text AS fee,t.sender_id AS user_id,s.full_name AS user_name,r.full_name AS recipient_name,t.created_at FROM transactions t LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN users r ON r.id=t.receiver_id WHERE ($2::text IS NULL OR LOWER(t.status::text)=LOWER($2)) AND ($1='%%' OR t.reference_code ILIKE $1 OR s.full_name ILIKE $1 OR s.phone ILIKE $1 OR s.id_wallet ILIKE $1 OR r.full_name ILIKE $1 OR r.phone ILIKE $1) ORDER BY t.created_at DESC NULLS LAST,t.id DESC LIMIT 26 OFFSET $3",
            args,
          )
        ).rows;
      if (kind === "cards")
        return (
          await db.query(
            `SELECT c.id,c.user_id,u.full_name AS user_name,u.id_wallet,u.phone,c.status::text AS status,to_jsonb(c)->>'card_type' AS card_type,to_jsonb(c)->>'brand' AS brand,to_jsonb(c)->>'currency' AS currency,c.created_at FROM card_requests c JOIN users u ON u.id=c.user_id WHERE ${access.sql} AND ($2::text IS NULL OR LOWER(c.status::text)=LOWER($2)) AND ($1='%%' OR u.full_name ILIKE $1 OR u.phone ILIKE $1 OR u.id_wallet ILIKE $1) ORDER BY c.created_at DESC NULLS LAST,c.id DESC LIMIT 26 OFFSET $3`,
            args,
          )
        ).rows;
      if (kind === "orders")
        return (
          await db.query(
            "SELECT o.id,o.reference,o.user_id,u.full_name AS user_name,o.status::text AS status,o.total_amount::text AS amount,COALESCE(to_jsonb(o)->>'currency',t.currency) AS currency,o.created_at FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN transactions t ON t.id::text=to_jsonb(o)->>'transaction_id' WHERE ($2::text IS NULL OR LOWER(o.status::text)=LOWER($2)) AND ($1='%%' OR o.reference ILIKE $1 OR u.full_name ILIKE $1 OR u.phone ILIKE $1 OR u.id_wallet ILIKE $1 OR EXISTS(SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id JOIN users seller ON seller.id=p.agent_id WHERE oi.order_id=o.id AND (seller.full_name ILIKE $1 OR seller.phone ILIKE $1 OR seller.id_wallet ILIKE $1))) ORDER BY o.created_at DESC NULLS LAST,o.id DESC LIMIT 26 OFFSET $3",
            args,
          )
        ).rows;
      return (
        await db.query(
          `SELECT i.id,i.target_user_id AS user_id,u.full_name AS user_name,u.id_wallet,a.full_name AS actor_name,i.action_type AS status,i.detail,i.created_at FROM super_agent_interventions i LEFT JOIN users u ON u.id=i.target_user_id LEFT JOIN users a ON a.id=i.admin_user_id WHERE (${actor.role === "Admin" ? "$4::int IS NOT NULL OR $4::int IS NULL" : "i.admin_user_id=$4 AND " + access.sql}) AND i.action_type IN ('ACCOUNT_CREATE','ACCOUNT_WELCOME','CLIENT_UPDATE','ROLE_UPGRADE_B2B','CARD_ORDER','CARD_ORDER_NOTIFICATION','ACCOUNT_MANAGER_ASSIGN') AND ($2::text IS NULL OR i.action_type=$2) AND ($1='%%' OR u.full_name ILIKE $1 OR u.id_wallet ILIKE $1 OR u.phone ILIKE $1 OR a.full_name ILIKE $1) ORDER BY i.created_at DESC NULLS LAST,i.id DESC LIMIT 26 OFFSET $3`,
          args,
        )
      ).rows;
    });
    return {
      ...result,
      rows: result.rows.slice(0, 25).map(({ detail, ...row }) => {
        if (kind !== "registrations") return row;
        let decoded;
        try {
          decoded = JSON.parse(detail);
        } catch {}
        const summary =
          ["ACCOUNT_WELCOME", "CARD_ORDER_NOTIFICATION"].includes(row.status) &&
          decoded
            ? ["email", "sms", "whatsapp"]
                .map(
                  (key) => key + ": " + String(decoded[key] || "non renseigné"),
                )
                .join(" · ")
            : decoded?.reason ||
              decoded?.company_name ||
              (decoded?.registration
                ? "Inscription avec photo, signature et pièce"
                : String(detail || "").slice(0, 500));
        return { ...row, summary };
      }),
      hasMore: result.rows.length > 25,
      page,
    };
  });
}
export async function orderDetails(pool, id) {
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      "SELECT o.id,o.reference,o.user_id,o.status::text AS status,o.total_amount::text AS amount,COALESCE(to_jsonb(o)->>'currency',t.currency) AS currency,o.created_at,u.full_name AS buyer_name FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN transactions t ON t.id::text=to_jsonb(o)->>'transaction_id' WHERE o.id=$1",
      [id],
    );
    if (!rows[0])
      throw Object.assign(Error("Commande introuvable."), {
        status: 404,
        expose: true,
      });
    const items = await optionalSection(
      db,
      async () =>
        (
          await db.query(
            "SELECT p.id AS product_id,p.name AS product_name,oi.quantity::text AS quantity,p.agent_id AS seller_id,u.full_name AS seller_name FROM order_items oi JOIN products p ON p.id=oi.product_id LEFT JOIN users u ON u.id=p.agent_id WHERE oi.order_id=$1 ORDER BY p.id",
            [id],
          )
        ).rows,
    );
    return { order: rows[0], items };
  });
}
