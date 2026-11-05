import countries from "./countries.json" with { type: "json" };
const aliases = Object.fromEntries(
  countries.flatMap((c) => [
    [c.code.toLowerCase(), c.code],
    [c.name.toLowerCase(), c.code],
  ]),
);
export const staffRoles = ["Admin", "AccountManager"];
export const deny = (
  message = "Accès réservé à cette fonction.",
  status = 403,
) => Object.assign(Error(message), { status, expose: true });
export const countryCode = (value) =>
  aliases[
    String(value || "")
      .trim()
      .toLowerCase()
  ] || null;
export function assertRegistrationScope(actor, country, province) {
  if (actor.role === "Admin") return;
  if (actor.role !== "AccountManager" || !countryCode(actor.country))
    throw deny("Périmètre du gestionnaire non configuré.");
  if (
    countryCode(actor.country) !== countryCode(country) ||
    (actor.province &&
      String(actor.province).trim().toLowerCase() !==
        String(province || "")
          .trim()
          .toLowerCase())
  )
    throw deny("Client hors du périmètre pays/province attribué.");
}
export async function assertClientScope(db, actor, id) {
  const { rows } = await db.query(
    "SELECT id,role::text AS role,country,province FROM users WHERE id=$1",
    [id],
  );
  const target = rows[0];
  if (!target) throw deny("Compte introuvable.", 404);
  if (actor.role === "Admin") return target;
  if (target.role !== "Client")
    throw deny("Compte non accessible au gestionnaire.");
  assertRegistrationScope(actor, target.country, target.province);
  return target;
}
export function clientFilter(actor, alias = "u", start = 1) {
  if (actor.role === "Admin") return { sql: "TRUE", values: [] };
  const code = countryCode(actor.country);
  if (actor.role !== "AccountManager" || !code)
    throw deny("Périmètre du gestionnaire non configuré.");
  const labels = countries
    .filter((c) => c.code === code)
    .flatMap((c) => [c.code.toLowerCase(), c.name.toLowerCase()]);
  const values = [labels];
  let sql = `${alias}.role::text='Client' AND LOWER(TRIM(${alias}.country))=ANY($${start}::text[])`;
  if (actor.province) {
    values.push(String(actor.province).trim().toLowerCase());
    sql += ` AND LOWER(TRIM(${alias}.province))=$${start + 1}`;
  }
  return { sql, values };
}
