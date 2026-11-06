import { adminPin, provisionPartner } from "./client-management.js";
import { deny, countryCode } from "./staff-access.js";
import countries from "./countries.json" with { type: "json" };
import { requireMessageSchema, queueActionNotice } from "./message-outbox.js";

export const assignableRoles = {
  Client: "Client",
  Agent: "Agent",
  SuperAgent: "Super agent",
  SubSuperAgent: "Sous-super agent",
  Admin: "Administrateur",
  PartnerB2B: "Partenaire B2B",
  AccountManager: "Gestionnaire de compte",
};
const scopedRoles = ["Agent", "SuperAgent", "SubSuperAgent", "AccountManager"];
const provincial = ["SubSuperAgent"];
export async function roleCatalog(pool) {
  const result = await pool.query(
    `SELECT t.typtype,e.enumlabel FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_enum e ON e.enumtypid=t.oid WHERE a.attrelid='users'::regclass AND a.attname='role' AND NOT a.attisdropped ORDER BY e.enumsortorder`,
  );
  const isEnum = result.rows.some((r) => r.typtype === "e"),
    available = new Set(result.rows.map((r) => r.enumlabel));
  return {
    roles: Object.entries(assignableRoles)
      .filter(([code]) => !isEnum || available.has(code))
      .map(([code, label]) => ({ code, label })),
    countries,
    scoped_roles: scopedRoles,
    provincial_roles: provincial,
  };
}
export async function assignAccountManager(pool, actor, id, body) {
  if (!["Client", "AccountManager"].includes(body?.role))
    throw deny("Rôle non autorisé.", 400);
  return assignRole(
    pool,
    actor,
    id,
    { ...body, reason: body.reason || "Habilitation depuis CashPay Admin" },
    true,
  );
}
export async function assignRole(pool, actor, id, body, legacy = false) {
  if (actor.role !== "Admin" || Number(actor.id) === Number(id))
    throw deny("Vous ne pouvez pas modifier votre propre habilitation.");
  if (
    typeof body?.role !== "string" ||
    !Object.hasOwn(assignableRoles, body.role)
  )
    throw deny("Rôle non autorisé.", 400);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 500)
    throw deny("Motif de 10 à 500 caractères requis.", 400);
  if (body.province !== undefined && typeof body.province !== "string")
    throw deny("Province invalide.", 400);
  const province =
    typeof body.province === "string" ? body.province.trim() : "";
  if (province.length > 150 || /[\x00-\x1f]/.test(province))
    throw deny("Province invalide.", 400);
  const catalog = await roleCatalog(pool);
  if (!catalog.roles.some((r) => r.code === body.role))
    throw deny(
      "Ce rôle n’existe pas dans l’énumération PostgreSQL installée.",
      409,
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    await requireMessageSchema(db);
    const fresh = await adminPin(db, actor, body.admin_pin);
    if (fresh.role !== "Admin") throw deny();
    const target = (
      await db.query(
        "SELECT id,role::text AS role,country,province,status::text AS status,email,id_wallet FROM users WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!target || String(target.status).toLowerCase() !== "active")
      throw deny("Utilisateur actif requis.", 409);
    if (legacy && !["Client", "AccountManager"].includes(target.role))
      throw deny("Utilisez la nomination générale pour ce compte.", 409);
    if (body.expected_role && body.expected_role !== target.role)
      throw deny("Le rôle a changé. Rechargez la fiche.", 409);
    if (
      ["Admin", "AccountManager"].includes(body.role) &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.email || "")
    )
      throw deny(
        "Renseignez une adresse e-mail valide avant de nommer ce rôle du back-office.",
        400,
      );
    const code = body.countryCode ? countryCode(body.countryCode) : null;
    if (body.countryCode && !code) throw deny("Pays invalide.", 400);
    if (scopedRoles.includes(body.role) && !code)
      throw deny("Pays attribué requis.", 400);
    if (provincial.includes(body.role) && !province)
      throw deny("Province attribuée requise.", 400);
    const country = code
      ? countries.find((c) => c.code === code).name
      : target.country;
    let end = null;
    if (body.role === "Agent") {
      const days = Number(body.agent_days);
      if (!Number.isInteger(days) || days < 1 || days > 365)
        throw deny(
          "Accès Agent offert : choisissez de 1 à 365 jours. Aucun débit n’est effectué.",
          400,
        );
      end = (
        await db.query(
          `INSERT INTO agent_subscriptions(user_id,status,current_period_end,is_promo_period,auto_renew) VALUES($1,'active',NOW()+($2::integer*INTERVAL '1 day'),FALSE,FALSE)
     ON CONFLICT(user_id) DO UPDATE SET status='active',current_period_end=GREATEST(agent_subscriptions.current_period_end,EXCLUDED.current_period_end),updated_at=NOW() RETURNING current_period_end`,
          [id, days],
        )
      ).rows[0].current_period_end;
    } else if (target.role === "Agent")
      await db.query(
        "UPDATE agent_subscriptions SET status='cancelled',auto_renew=FALSE,updated_at=NOW() WHERE user_id=$1",
        [id],
      );
    if (body.role === "PartnerB2B" && target.role !== "PartnerB2B") {
      const name =
        typeof body.company_name === "string" ? body.company_name.trim() : "";
      if (name.length < 2 || name.length > 150 || /[\x00-\x1f]/.test(name))
        throw deny("Nom de société de 2 à 150 caractères requis.", 400);
      await provisionPartner(db, id, name);
    } else if (target.role === "PartnerB2B" && body.role !== "PartnerB2B") {
      await db.query(
        "UPDATE users SET api_key=NULL,api_secret=NULL,test_api_key=NULL,test_api_secret=NULL WHERE id=$1",
        [id],
      );
      await db.query(
        "UPDATE b2b_partners SET api_key=NULL WHERE owner_user_id=$1",
        [id],
      );
    }
    await db.query(
      "UPDATE users SET role=$2,country=$3,province=$4 WHERE id=$1",
      [
        id,
        body.role,
        country,
        scopedRoles.includes(body.role) ? province || null : target.province,
      ],
    );
    const after = {
      role: body.role,
      country,
      province: scopedRoles.includes(body.role)
        ? province || null
        : target.province,
      agent_period_end: end,
    };
    await db.query(
      "INSERT INTO super_agent_interventions(admin_user_id,target_user_id,action_type,detail) VALUES($1,$2,$3,$4)",
      [
        actor.id,
        id,
        "ROLE_ASSIGNMENT",
        JSON.stringify({
          before: {
            role: target.role,
            country: target.country,
            province: target.province,
          },
          after,
          reason,
        }),
      ],
    );
    const notificationId = await queueActionNotice(db, {
      actorId: actor.id,
      targetId: id,
      subject: "Votre habilitation CashPay a été mise à jour",
      message: `Votre compte ${target.id_wallet} a été nommé « ${assignableRoles[body.role]} »${country ? " — " + country : ""}${province ? " / " + province : ""}.${end ? " Accès Agent valable jusqu’au " + new Date(end).toISOString() + ", sans débit pour cette nomination." : ""}`,
      action: "ROLE_ASSIGNMENT",
    });
    await db.query("COMMIT");
    return {
      success: true,
      role: body.role,
      notification_id: notificationId,
      agent_period_end: end,
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
