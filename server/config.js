export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const origin = new URL(env.ADMIN_PUBLIC_ORIGIN || "http://127.0.0.1:8010");
  if (
    origin.origin !== origin.href.replace(/\/$/, "") ||
    origin.username ||
    origin.password ||
    (!["https:"].includes(origin.protocol) &&
      !(!production && ["localhost", "127.0.0.1"].includes(origin.hostname)))
  )
    throw Error("ADMIN_PUBLIC_ORIGIN doit être une origine HTTPS valide.");
  if (production && !env.ADMIN_PUBLIC_ORIGIN)
    throw Error("ADMIN_PUBLIC_ORIGIN requis en production.");
  if (
    !env.ADMIN_SESSION_SECRET ||
    Buffer.byteLength(env.ADMIN_SESSION_SECRET) < 32
  )
    throw Error(
      "ADMIN_SESSION_SECRET indépendant de 32 caractères minimum requis.",
    );
  const media = new URL(
    env.CASH_PAY_PUBLIC_ORIGIN || "https://app.cashpay-all.com",
  );
  if (
    media.protocol !== "https:" ||
    media.username ||
    media.password ||
    media.pathname !== "/" ||
    media.search ||
    media.hash
  )
    throw Error("CASH_PAY_PUBLIC_ORIGIN doit être une origine HTTPS.");
  const schema = env.DB_SCHEMA || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema))
    throw Error("DB_SCHEMA invalide.");
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER)
    throw Error("DB_HOST, DB_NAME et DB_USER requis.");
  const port = Number(env.PORT || 8010),
    dbPort = Number(env.DB_PORT || 5432);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(dbPort) ||
    dbPort < 1 ||
    dbPort > 65535
  )
    throw Error("Port invalide.");
  if (env.DB_SSL && !["true", "false"].includes(env.DB_SSL))
    throw Error("DB_SSL doit être true ou false.");
  const sessionHours = Number(env.ADMIN_SESSION_HOURS || 8),
    sessionIdleMinutes = Number(env.ADMIN_SESSION_IDLE_MINUTES || 60),
    smtpPort = Number(env.SMTP_PORT || 587);
  if (
    !Number.isFinite(sessionHours) ||
    sessionHours < 1 ||
    sessionHours > 24 ||
    !Number.isInteger(sessionIdleMinutes) ||
    sessionIdleMinutes < 5 ||
    sessionIdleMinutes > 480
  )
    throw Error("Durée de session invalide.");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535)
    throw Error("SMTP_PORT invalide.");
  return {
    production,
    sessionHours,
    sessionIdleMinutes,
    stateDir: env.ADMIN_STATE_DIR || ".runtime",
    avatarRoot: env.CASH_PAY_AVATAR_DIR || null,
    sms: {
      url: env.DREAM_DIGITAL_API_URL,
      id: env.DREAM_DIGITAL_API_ID,
      password: env.DREAM_DIGITAL_API_PASSWORD,
      sender: env.DREAM_DIGITAL_SENDER_ID || "CashPay",
    },
    whatsapp: {
      phoneId: env.WHATSAPP_PHONE_NUMBER_ID,
      token: env.WHATSAPP_ACCESS_TOKEN,
    },
    smtp: {
      host: env.SMTP_HOST,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      port: smtpPort,
    },
    origin: origin.origin,
    mediaOrigin: media.origin,
    secret: env.ADMIN_SESSION_SECRET,
    host: env.HOST || "127.0.0.1",
    port,
    database: {
      host: env.DB_HOST,
      port: dbPort,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      schema,
      ssl:
        env.DB_SSL === "true"
          ? {
              rejectUnauthorized: true,
              ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA } : {}),
            }
          : undefined,
    },
  };
}
