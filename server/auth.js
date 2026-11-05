import jwt from "jsonwebtoken";
import crypto from "node:crypto";
export const cookieName = "cashpay-admin-session";
export function sessionOptions(config) {
  return {
    httpOnly: true,
    secure: config.production || config.origin.startsWith("https:"),
    sameSite: "strict",
    path: "/",
    maxAge: (config.sessionHours || 8) * 60 * 60 * 1000,
  };
}
export async function issueSession(user, config, sessions) {
  const duration = (config.sessionHours || 8) * 60 * 60 * 1000;
  const session = await sessions.create(
    user.id,
    duration,
    (config.sessionIdleMinutes || 60) * 60000,
  );
  return jwt.sign(
    { csrf: crypto.randomBytes(24).toString("hex"), method: "email-otp-pin" },
    config.secret,
    {
      jwtid: session.id,
      subject: String(user.id),
      issuer: "cashpay-admin",
      audience: config.origin,
      expiresIn: Math.floor(duration / 1000),
      algorithm: "HS256",
    },
  );
}
export function readSession(req, config, sessions) {
  try {
    const token = req.cookies[cookieName];
    if (!token) return null;
    const data = jwt.verify(token, config.secret, {
      algorithms: ["HS256"],
      issuer: "cashpay-admin",
      audience: config.origin,
    });
    if (
      typeof data !== "object" ||
      data.method !== "email-otp-pin" ||
      !/^[1-9]\d*$/.test(data.sub || "")
    )
      return null;
    const record = sessions.get(data.jti);
    return record?.userId === Number(data.sub) ? data : null;
  } catch {
    return null;
  }
}
export async function findAdmin(pool, id) {
  const { rows } = await pool.query(
    "SELECT id,full_name,role::text AS role,status::text AS status,profile_photo FROM users WHERE id=$1 AND role::text='Admin' AND LOWER(TRIM(status::text))='active'",
    [id],
  );
  return rows[0] || null;
}
export async function findStaff(pool, id) {
  const { rows } = await pool.query(
    "SELECT id,id_wallet,full_name,role::text AS role,status::text AS status,profile_photo,country,province FROM users WHERE id=$1 AND role::text IN ('Admin','AccountManager') AND LOWER(TRIM(status::text))='active'",
    [id],
  );
  return rows[0] || null;
}
export function loginLimiter() {
  const entries = new Map();
  let sweep = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now > sweep) {
      for (const [key, value] of entries)
        if (value.until < now) entries.delete(key);
      sweep = now + 60000;
    }
    if (entries.size > 50000)
      return res
        .status(429)
        .json({ error: "Trop de connexions. Réessayez plus tard." });
    const rawIdentifier = req.body?.identifier ?? req.body?.email;
    const email =
      typeof rawIdentifier === "string"
        ? rawIdentifier.toLowerCase().trim()
        : "";
    for (const key of [
      `ip:${req.ip}`,
      `email:${crypto.createHash("sha256").update(email).digest("hex")}`,
    ]) {
      const state = entries.get(key) || { count: 0, until: now + 15 * 60000 };
      if (state.until < now) {
        state.count = 0;
        state.until = now + 15 * 60000;
      }
      state.count++;
      entries.set(key, state);
      if (state.count > (key.startsWith("ip:") ? 30 : 8)) {
        res.set("Retry-After", String(Math.ceil((state.until - now) / 1000)));
        return res
          .status(429)
          .json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
      }
    }
    next();
  };
}
