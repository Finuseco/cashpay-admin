import bcrypt from "bcryptjs";
import { adminPin } from "./client-management.js";
import { deny } from "./staff-access.js";
import { queueActionNotice, requireMessageSchema } from "./message-outbox.js";

export async function updateStaffProfile(pool, actor, body, media) {
  const action = body?.action;
  if (!["avatar", "pin"].includes(action))
    throw deny("Modification non autorisée.", 400);
  if (
    action === "pin" &&
    (typeof body.new_pin !== "string" ||
      !/^\d{4,6}$/.test(body.new_pin) ||
      body.new_pin !== body.confirm_pin ||
      body.new_pin === body.current_pin)
  )
    throw deny(
      "Saisissez et confirmez un nouveau PIN différent, de 4 à 6 chiffres.",
      400,
    );
  const image =
    action === "avatar"
      ? await media.resolve(actor, body.avatar_id, "avatar")
      : null;
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    await requireMessageSchema(db);
    // Serialize simultaneous self-service changes before checking the current PIN.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor.id]);
    await adminPin(db, actor, body.current_pin);
    if (action === "pin")
      await db.query("UPDATE users SET pin_hash=$2 WHERE id=$1", [
        actor.id,
        await bcrypt.hash(body.new_pin, 12),
      ]);
    else
      await db.query("UPDATE users SET profile_photo=$2 WHERE id=$1", [
        actor.id,
        image.url,
      ]);
    await db.query(
      "INSERT INTO super_agent_interventions(admin_user_id,target_user_id,action_type,detail) VALUES($1,$1,$2,$3)",
      [
        actor.id,
        action === "pin" ? "STAFF_PIN_CHANGE" : "STAFF_AVATAR_CHANGE",
        JSON.stringify({
          source: "self_service",
          field: action === "pin" ? "pin" : "profile_photo",
        }),
      ],
    );
    await queueActionNotice(db, {
      actorId: actor.id,
      targetId: actor.id,
      subject:
        action === "pin"
          ? "Votre PIN CashPay a été modifié"
          : "Votre photo CashPay a été modifiée",
      message:
        action === "pin"
          ? "Le PIN de votre compte CashPay a été modifié depuis votre profil professionnel. Si vous n’êtes pas à l’origine de cette action, contactez immédiatement votre administration."
          : "La photo de votre compte CashPay a été mise à jour depuis votre profil professionnel.",
      action: action === "pin" ? "STAFF_PIN_CHANGE" : "STAFF_AVATAR_CHANGE",
    });
    await db.query("COMMIT");
    return {
      success: true,
      reauthenticate: action === "pin",
      ...(image ? { profile_photo: image.url } : {}),
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
