import { adminPin } from "./client-management.js";
import { deny, countryCode } from "./staff-access.js";
import countries from "./countries.json" with { type: "json" };
export async function assignAccountManager(pool, actor, id, body) {
  if (actor.role !== "Admin" || Number(actor.id) === Number(id)) throw deny();
  if (!["AccountManager", "Client"].includes(body?.role))
    throw deny("Rôle non autorisé.", 400);
  if (body.province !== undefined && typeof body.province !== "string")
    throw deny("Province invalide.", 400);
  const code = countryCode(body.countryCode),
    province = typeof body.province === "string" ? body.province.trim() : "";
  if (
    body.role === "AccountManager" &&
    (!code || province.length > 150 || /[\x00-\x1f]/.test(province))
  )
    throw deny(
      "Pays valide et province de 150 caractères maximum requis.",
      400,
    );
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    const freshActor = await adminPin(db, actor, body.admin_pin);
    if (freshActor.role !== "Admin") throw deny();
    const { rows } = await db.query(
      "SELECT role::text AS role,country,province,status::text AS status FROM users WHERE id=$1 FOR UPDATE",
      [id],
    );
    const target = rows[0];
    if (
      !target ||
      !["Client", "AccountManager"].includes(target.role) ||
      String(target.status).toLowerCase() !== "active"
    )
      throw deny(
        "Nomination réservée aux Clients ou Gestionnaires actifs.",
        409,
      );
    const country =
      body.role === "AccountManager"
        ? countries.find((c) => c.code === code).name
        : target.country;
    const assignedProvince =
      body.role === "AccountManager" ? province || null : target.province;
    await db.query(
      "UPDATE users SET role=$2,country=$3,province=$4 WHERE id=$1",
      [id, body.role, country, assignedProvince],
    );
    await db.query(
      "INSERT INTO super_agent_interventions (admin_user_id,target_user_id,action_type,detail) VALUES ($1,$2,$3,$4)",
      [
        actor.id,
        id,
        "ACCOUNT_MANAGER_ASSIGN",
        JSON.stringify({
          previous_role: target.role,
          role: body.role,
          country,
          province: assignedProvince,
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
