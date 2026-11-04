import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
export const cookieName = "cashpay-admin-session";
const dummyHash = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10);
export function verifyTotp(secret, code, now = Date.now()) {
  if (!/^[0-9]{6}$/.test(code || "")) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    clean = String(secret).replace(/[\s=]/g, "").toUpperCase();
  if (!clean || !/^[A-Z2-7]+$/.test(clean)) return false;
  let bits = "";
  for (const char of clean)
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(
    (bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)),
  );
  if (!key.length) return false;
  for (let delta = -1; delta <= 1; delta++) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000) + delta));
    const hash = crypto.createHmac("sha1", key).update(counter).digest(),
      offset = hash.at(-1) & 15;
    const value = (hash.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    if (
      crypto.timingSafeEqual(
        Buffer.from(String(value).padStart(6, "0")),
        Buffer.from(code),
      )
    )
      return true;
  }
  return false;
}
export function sessionOptions(config) {
  return {
    httpOnly: true,
    secure: config.production || config.origin.startsWith("https:"),
    sameSite: "strict",
    path: "/",
    maxAge: 30 * 60 * 1000,
  };
}
export function issueSession(user, config, sessions) {
  const now = Date.now();
  for (const [id, until] of sessions) if (until < now) sessions.delete(id);
  if (sessions.size >= 10000) throw Error("Trop de sessions actives.");
  const id = crypto.randomUUID();
  sessions.set(id, now + 30 * 60000);
  return jwt.sign(
    { csrf: crypto.randomBytes(24).toString("hex") },
    config.secret,
    {
      jwtid: id,
      subject: String(user.id),
      issuer: "cashpay-admin",
      audience: config.origin,
      expiresIn: "30m",
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
    return typeof data === "object" &&
      /^[1-9]\d*$/.test(data.sub || "") &&
      (sessions.get(data.jti) || 0) > Date.now()
      ? data
      : null;
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
export async function authenticatePassword(pool, email, password, otp) {
  const { rows } = await pool.query(
    "SELECT id,role::text AS role,status::text AS status,password_hash,to_jsonb(users)->>'totp_secret' AS totp_secret FROM users WHERE LOWER(TRIM(email))=$1 LIMIT 2",
    [email],
  );
  const user = rows.length === 1 ? rows[0] : null;
  const match = await bcrypt
    .compare(password, user?.password_hash || dummyHash)
    .catch(() => false);
  if (
    !match ||
    user?.role !== "Admin" ||
    String(user.status).toLowerCase() !== "active" ||
    (user.totp_secret && !verifyTotp(user.totp_secret, otp))
  )
    return null;
  return user;
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
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.toLowerCase().trim()
        : "";
    const keys = [
      `ip:${req.ip}`,
      `email:${crypto.createHash("sha256").update(email).digest("hex")}`,
    ];
    for (const key of keys) {
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
