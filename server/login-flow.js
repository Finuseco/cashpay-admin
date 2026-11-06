import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
export const challengeCookie = "cashpay-admin-challenge";
const lifetime = 10 * 60000,
  cooldown = 60000,
  maxAttempts = 5;
const failure = (message, status = 401, retryAfter) =>
  Object.assign(Error(message), { status, retryAfter, expose: true });
const normalize = (email) =>
  typeof email === "string" ? email.toLowerCase().trim() : "";
const masked = (email) => {
  const [name, domain] = email.split("@");
  return name.slice(0, 1) + "***@" + domain;
};
export function createLoginFlow({ pool, config, sendOtp, clock = Date.now }) {
  const challenges = new Map(),
    recentEmails = new Map(),
    pinFailures = new Map();
  const hash = (id, code) =>
    crypto
      .createHmac("sha256", config.secret)
      .update("admin-email-otp:" + id + ":" + code)
      .digest();
  function sweep() {
    const now = clock();
    for (const [id, value] of challenges)
      if (value.expiresAt <= now) challenges.delete(id);
    for (const [email, until] of recentEmails)
      if (until <= now) recentEmails.delete(email);
    for (const [id, value] of pinFailures)
      if (value.until <= now) pinFailures.delete(id);
  }
  function cookieOptions() {
    return {
      httpOnly: true,
      secure: config.production || config.origin.startsWith("https:"),
      sameSite: "strict",
      path: "/api/auth",
      maxAge: lifetime,
    };
  }
  function resolve(req) {
    try {
      const raw = req.cookies[challengeCookie];
      if (!raw) return null;
      const payload = jwt.verify(raw, config.secret, {
        algorithms: ["HS256"],
        issuer: "cashpay-admin-login",
        audience: config.origin,
        clockTimestamp: Math.floor(clock() / 1000),
      });
      const current =
        typeof payload === "object" ? challenges.get(payload.jti) : null;
      if (!current || current.expiresAt <= clock()) return null;
      return current;
    } catch {
      return null;
    }
  }
  async function readUser(id) {
    const { rows } = await pool.query(
      "SELECT id,email,full_name,pin_hash,role::text AS role,status::text AS status FROM users WHERE id=$1 AND role::text IN ('Admin','AccountManager') AND LOWER(TRIM(status::text))='active'",
      [id],
    );
    return rows[0] || null;
  }
  async function active(current) {
    const user = await readUser(current.userId);
    if (challenges.get(current.id) !== current || current.expiresAt <= clock())
      throw failure("Demande expirée. Recommencez.", 410);
    if (!user || normalize(user.email) !== current.email || !user.pin_hash) {
      challenges.delete(current.id);
      throw failure(
        "Compte Admin ou Gestionnaire actif et PIN configuré requis.",
        403,
      );
    }
    return user;
  }
  async function start(req) {
    sweep();
    const identifier = normalize(
      req.body?.identifier || req.body?.email || resolve(req)?.email,
    );
    const isEmail = identifier.includes("@");
    if (
      !identifier ||
      identifier.length > 254 ||
      (isEmail
        ? !/^[^\s@]+@[^@\s]+\.[^@\s]+$/.test(identifier)
        : !/^[a-z0-9]{4,64}$/i.test(identifier))
    )
      throw failure("Saisissez votre ID Wallet ou votre adresse e-mail.", 400);
    if (challenges.size >= 5000)
      throw failure("Trop de connexions en cours. Réessayez plus tard.", 503);
    const { rows } = await pool.query(
      "SELECT id,email,full_name,pin_hash FROM users WHERE ((LOWER(TRIM(email))=$1 AND $2::boolean) OR (LOWER(TRIM(id_wallet))=$1 AND NOT $2::boolean)) AND role::text IN ('Admin','AccountManager') AND LOWER(TRIM(status::text))='active' LIMIT 2",
      [identifier, isEmail],
    );
    if (rows.length !== 1 || !rows[0].pin_hash)
      throw failure(
        "Compte Admin ou Gestionnaire actif et PIN configuré requis.",
        403,
      );
    const user = rows[0];
    const email = normalize(user.email);
    if (!/^[^\s@]+@[^@\s]+\.[^@\s]+$/.test(email))
      throw failure(
        "Ce compte doit posséder une adresse e-mail valide pour recevoir l’OTP.",
        403,
      );
    // Recheck after the asynchronous query so concurrent sends cannot bypass cooldown.
    if ((recentEmails.get(email) || 0) > clock())
      throw failure("Veuillez patienter avant de renvoyer un code.", 429, 60);
    const previous = resolve(req);
    if (previous) challenges.delete(previous.id);
    for (const [id, value] of challenges)
      if (value.userId === Number(user.id)) challenges.delete(id);
    const id = crypto.randomUUID(),
      code = crypto.randomInt(0, 1000000).toString().padStart(6, "0"),
      now = clock();
    const current = {
      id,
      userId: Number(user.id),
      email,
      otpHash: hash(id, code),
      expiresAt: now + lifetime,
      resendAt: now + cooldown,
      stage: "sending",
      otpAttempts: 0,
      pinAttempts: 0,
      busy: false,
    };
    challenges.set(id, current);
    recentEmails.set(email, now + cooldown);
    try {
      await sendOtp({
        email: user.email,
        name: user.full_name,
        code,
        ip: req.ip,
      });
    } catch (error) {
      challenges.delete(id);
      console.warn("[admin OTP mail]", error.code || "delivery_failed");
      throw failure(
        "Le code n’a pas pu être envoyé. Vérifiez le service e-mail puis réessayez.",
        503,
      );
    }
    if (challenges.get(id) !== current || current.expiresAt <= clock())
      throw failure("Demande expirée. Recommencez.", 410);
    current.stage = "otp";
    const token = jwt.sign({}, config.secret, {
      jwtid: id,
      issuer: "cashpay-admin-login",
      audience: config.origin,
      expiresIn: Math.floor(lifetime / 1000),
      algorithm: "HS256",
    });
    return { token, data: describe(current) };
  }
  function describe(current) {
    return current
      ? {
          step: current.stage === "pin" ? "pin" : "otp",
          destination: masked(current.email),
          expiresAt: current.expiresAt,
          resendAt: current.resendAt,
        }
      : { step: "email" };
  }
  async function run(req, step, work) {
    sweep();
    const current = resolve(req);
    if (!current) throw failure("Demande expirée. Renvoyez un code.", 410);
    if (current.stage !== step)
      throw failure("Respectez les étapes e-mail, OTP puis PIN.", 409);
    if (current.busy)
      throw failure("Vérification en cours. Patientez.", 429, 1);
    current.busy = true;
    try {
      return await work(current);
    } finally {
      current.busy = false;
    }
  }
  async function verifyOtp(req) {
    return run(req, "otp", async (current) => {
      await active(current);
      const otp = req.body?.otp;
      if (typeof otp !== "string" || !/^\d{6}$/.test(otp))
        throw failure("Le code doit contenir six chiffres.", 400);
      current.otpAttempts++;
      if (!crypto.timingSafeEqual(hash(current.id, otp), current.otpHash)) {
        if (current.otpAttempts >= maxAttempts) {
          challenges.delete(current.id);
          throw failure(
            "Trop de codes incorrects. Recommencez la connexion.",
            429,
          );
        }
        throw failure("Code incorrect. Réessayez.");
      }
      current.otpHash = null;
      current.stage = "pin";
      current.expiresAt = Math.min(current.expiresAt, clock() + 5 * 60000);
      return describe(current);
    });
  }
  async function verifyPin(req) {
    return run(req, "pin", async (current) => {
      const user = await active(current),
        pin = req.body?.pin;
      const failed = pinFailures.get(current.userId);
      if (failed?.until > clock() && failed.count >= maxAttempts)
        throw failure(
          "Trop de PIN incorrects. Réessayez dans 15 minutes.",
          429,
          Math.ceil((failed.until - clock()) / 1000),
        );
      if (typeof pin !== "string" || !/^\d{4,6}$/.test(pin))
        throw failure(
          "Saisissez votre PIN Cashpay existant (4 à 6 chiffres).",
          400,
        );
      current.pinAttempts++;
      let valid = false;
      if (/^\$2[aby]\$/.test(user.pin_hash))
        valid = await bcrypt.compare(pin, user.pin_hash).catch(() => false);
      else if (
        /^\d{4,6}$/.test(user.pin_hash) &&
        pin.length === user.pin_hash.length
      )
        valid = crypto.timingSafeEqual(
          Buffer.from(pin),
          Buffer.from(user.pin_hash),
        );
      if (!valid) {
        const state = pinFailures.get(current.userId) || {
          count: 0,
          until: clock() + 15 * 60000,
        };
        state.count++;
        pinFailures.set(current.userId, state);
        if (current.pinAttempts >= maxAttempts) challenges.delete(current.id);
        throw failure(
          state.count >= maxAttempts
            ? "Trop de PIN incorrects. Réessayez dans 15 minutes."
            : "PIN incorrect.",
          state.count >= maxAttempts ? 429 : 401,
        );
      }
      const fresh = await active(current);
      if (fresh.pin_hash !== user.pin_hash)
        throw failure("Le PIN a été modifié. Recommencez.", 409);
      challenges.delete(current.id);
      pinFailures.delete(current.userId);
      return fresh;
    });
  }
  function reset(req) {
    const current = resolve(req);
    if (current) challenges.delete(current.id);
  }
  return {
    start,
    verifyOtp,
    verifyPin,
    describe: (req) => describe(resolve(req)),
    reset,
    cookieOptions,
  };
}
