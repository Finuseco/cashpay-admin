import crypto from "node:crypto";
import dialCodes from "./dial-codes.json" with { type: "json" };
import countries from "./registration-countries.json" with { type: "json" };
import { deny } from "./staff-access.js";

export async function requireMessageSchema(db) {
  const { rows } = await db.query(
    "SELECT to_regclass('admin_communications') AS campaigns,to_regclass('admin_message_deliveries') AS deliveries",
  );
  if (!rows[0]?.campaigns || !rows[0]?.deliveries) {
    const error = deny(
      "Installez d’abord le script docs/sql/admin-communications.sql dans Adminer.",
      503,
    );
    error.expose = true;
    throw error;
  }
}
export function messageDestination(user, channel) {
  const raw = channel === "email" ? user.email : user.phone;
  if (channel === "email")
    return typeof raw === "string" &&
      raw.trim().length <= 320 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())
      ? raw.trim()
      : null;
  if (typeof raw !== "string" || !/^\+?[\d\s().-]{7,30}$/.test(raw.trim()))
    return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("00")) digits = digits.slice(2);
  else if (!raw.trim().startsWith("+")) {
    const country = countries.find(
      (c) =>
        c.code.toLowerCase() === String(user.country).trim().toLowerCase() ||
        c.name.toLowerCase() === String(user.country).trim().toLowerCase(),
    );
    if (!country) return null;
    const dial = String(dialCodes[country.code] || "").replace(/\D/g, "");
    if (!dial) return null;
    if (!digits.startsWith(dial))
      digits =
        dial + (country.code === "IT" ? digits : digits.replace(/^0/, ""));
  }
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
}
export async function addDelivery(
  db,
  campaignId,
  user,
  channel,
  subject,
  text,
  html = null,
) {
  const destination = messageDestination(user, channel);
  await db.query(
    `INSERT INTO admin_message_deliveries(campaign_id,user_id,channel,destination,subject,message_text,message_html,status,error_code)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      campaignId,
      user.id,
      channel,
      destination,
      subject,
      text,
      html,
      destination ? "pending" : "skipped",
      destination ? null : "missing_destination",
    ],
  );
}
export async function queueActionNotice(
  db,
  { actorId, targetId = null, subject, message, action },
) {
  await requireMessageSchema(db);
  const ids = [
    ...new Set([Number(actorId), ...(targetId ? [Number(targetId)] : [])]),
  ];
  const { rows: users } = await db.query(
    "SELECT id,email,phone,country,first_name,last_name,id_wallet FROM users WHERE id=ANY($1::bigint[]) ORDER BY id",
    [ids],
  );
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO admin_communications(id,created_by,kind,channel,subject,message,format,filters,status,total)
    VALUES($1,$2,'action','email',$3,$4,'text',$5,'queued',$6)`,
    [
      id,
      actorId,
      subject,
      message,
      JSON.stringify({ action, target_id: targetId }),
      users.length,
    ],
  );
  for (const user of users) {
    const target = users.find(
      (person) => Number(person.id) === Number(targetId),
    );
    const actorMessage = message
      .replace(/Votre compte/g, "Le compte concerné")
      .replace(/votre compte/g, "ce compte");
    const text = `Bonjour${user.first_name ? " " + user.first_name : ""},\n\n${Number(user.id) === Number(targetId) ? message : `Action administrative ${action} enregistrée${targetId ? " sur le compte " + (target?.id_wallet || "#" + targetId) : ""}. ${actorMessage}`}\n\nDate : ${new Date().toISOString()}\nL’équipe CashPay All`;
    await addDelivery(db, id, user, "email", subject, text);
  }
  if (targetId)
    await db.query(
      "INSERT INTO notifications(user_id,title,description,type,link,is_read) VALUES($1,$2,$3,'general',NULL,FALSE)",
      [targetId, subject, message],
    );
  return id;
}
