import nodemailer from "nodemailer";
import { readFile } from "node:fs/promises";
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function smtpTransport(config) {
  if (!config.smtp?.host || !config.smtp.user || !config.smtp.password)
    throw Error("SMTP non configuré.");
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    requireTLS: config.smtp.port !== 465,
    auth: { user: config.smtp.user, pass: config.smtp.password },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export function createOtpMailer(config) {
  let transport;
  return async function sendOtp({ email, name, code, ip }) {
    if (!config.smtp?.host || !config.smtp.user || !config.smtp.password)
      throw Object.assign(
        Error(
          "Service e-mail non configuré. Vérifier les variables SMTP du back-office.",
        ),
        { status: 503 },
      );
    transport ||= nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      requireTLS: config.smtp.port !== 465,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      tls: { rejectUnauthorized: true },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const [base, body] = await Promise.all([
      readFile(
        new URL("./email-templates/_base.html", import.meta.url),
        "utf8",
      ),
      readFile(new URL("./email-templates/otp.html", import.meta.url), "utf8"),
    ]);
    const data = {
      title: "Connexion à Cashpay Admin",
      greeting: `Bonjour ${name || ""},`,
      intro:
        "Voici votre code à usage unique pour vous connecter au back-office Cashpay. Votre PIN existant vous sera demandé après vérification.",
      otpCode: code,
      warning:
        "Ce code est valide pendant 10 minutes. Ne le partagez avec personne.",
      signature: "L’équipe de sécurité Cashpay",
      ipAddress: ip,
      deviceType: "Accès au back-office",
      browser: "Navigateur web",
      operatingSystem: "Non déterminé",
      location: "Non déterminé",
      loginTime:
        new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date()) + " UTC",
      subject: "Votre code de connexion Cashpay Admin",
      year: new Date().getFullYear(),
    };
    const html = base
      .replace("{{{body}}}", body)
      .replace(/\{\{(\w+)\}\}/g, (_match, key) => escape(data[key]));
    const result = await transport.sendMail({
      from: { name: "CashPay All", address: config.smtp.user },
      to: email,
      subject: data.subject,
      html,
      text: `Votre code de connexion Cashpay Admin : ${code}. Valable 10 minutes. Ne le partagez pas. Vous devrez ensuite saisir votre PIN Cashpay existant.`,
    });
    if (
      !result.accepted?.some(
        (address) =>
          String(
            typeof address === "string" ? address : address.address,
          ).toLowerCase() === email.toLowerCase(),
      )
    )
      throw Object.assign(
        Error("Le serveur e-mail n’a pas accepté le destinataire."),
        { status: 502 },
      );
  };
}
