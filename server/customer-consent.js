import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { deny } from "./staff-access.js";
const failures = new Map();
export async function verifyCustomerConsent(hash, pin, id) {
  const now = Date.now();
  for (const [key, value] of failures)
    if (value.until <= now) failures.delete(key);
  const previous = failures.get(id);
  if (previous?.count >= 5)
    throw deny("Validation du titulaire bloquée pendant 15 minutes.", 429);
  let valid = false;
  if (
    typeof hash === "string" &&
    typeof pin === "string" &&
    /^\d{4,6}$/.test(pin)
  )
    valid = /^\$2[aby]\$/.test(hash)
      ? await bcrypt.compare(pin, hash).catch(() => false)
      : /^\d{4,6}$/.test(hash) &&
        pin.length === hash.length &&
        crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(hash));
  if (!valid) {
    const state = previous || { count: 0, until: now + 900000 };
    state.count++;
    failures.set(id, state);
    throw deny(
      "PIN du titulaire incorrect ou absent. Opération non effectuée.",
      state.count >= 5 ? 429 : 403,
    );
  }
  failures.delete(id);
}
