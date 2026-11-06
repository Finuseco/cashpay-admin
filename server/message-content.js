import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";
import { escape } from "./mailer.js";
import { deny } from "./staff-access.js";

const bad = (message) => deny(message, 400);
export const messageTokens = [
  "first_name",
  "last_name",
  "wallet_id",
  "email",
  "phone",
  "country",
  "role",
  "balances",
  "date",
];
export function cleanEmailHtml(value) {
  return sanitizeHtml(value, {
    allowedTags: [
      "p",
      "br",
      "div",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "hr",
      "table",
      "tbody",
      "thead",
      "tr",
      "td",
      "th",
      "a",
      "img",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title"],
      img: ["src", "alt", "width", "height"],
    },
    allowedSchemes: ["https", "mailto", "cid"],
    allowedSchemesByTag: { img: ["https", "cid"] },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [
          /^#[\da-f]{3,8}$/i,
          /^(?:black|white|gray|red|green|blue|purple|orange)$/i,
        ],
        "background-color": [
          /^#[\da-f]{3,8}$/i,
          /^(?:black|white|gray|red|green|blue|purple|orange)$/i,
        ],
        "text-align": [/^(?:left|right|center|justify)$/],
        "font-size": [/^\d{1,3}(?:px|pt|em|%)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        padding: [/^[\d .pxem%]+$/],
        margin: [/^[\d .pxem%]+$/],
        "border-collapse": [/^(?:collapse|separate)$/],
        width: [/^\d{1,4}(?:px|%)$/],
        "max-width": [/^\d{1,4}(?:px|%)$/],
      },
    },
  });
}
export function validateTokens(value) {
  const residue = value.replace(
    /\{\{\s*([a-z_]+(?:\.[A-Z0-9_]{2,16})?)\s*\}\}/g,
    (_all, token) => {
      if (
        !messageTokens.includes(token) &&
        !/^balance\.[A-Z0-9_]{2,16}$/.test(token)
      )
        throw bad("Raccourci inconnu : " + token);
      return "";
    },
  );
  if (residue.includes("{{") || residue.includes("}}"))
    throw bad(
      "Raccourci mal formé. Utilisez {{first_name}} ou {{balance.USD}}.",
    );
}
function tokenValue(user, token, stamp) {
  if (token.startsWith("balance."))
    return user.balance_values === null
      ? "Indisponible"
      : String(user.balance_values?.[token.slice(8)] ?? "0");
  if (token === "balances" && user.balance_values === null)
    return "Indisponible";
  if (token === "balances")
    return (
      Object.entries(user.balance_values || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, value]) => `${code} : ${value}`)
        .join(" ; ") || "Aucun solde enregistré"
    );
  if (token === "wallet_id") return String(user.id_wallet || "");
  if (token === "date") return stamp;
  return String(user[token] || "");
}
export function renderMessage(definition, user, stamp) {
  const replace = (value, html) =>
    value.replace(
      /\{\{\s*([a-z_]+(?:\.[A-Z0-9_]{2,16})?)\s*\}\}/g,
      (_all, token) =>
        html
          ? escape(tokenValue(user, token, stamp))
          : tokenValue(user, token, stamp),
    );
  const subject = replace(definition.subject, false).replace(/[\r\n]/g, " ");
  if (definition.format === "html") {
    const html = cleanEmailHtml(replace(definition.message, true));
    return { subject, html, text: convert(html, { wordwrap: 100 }) };
  }
  const text = replace(definition.message, false);
  return { subject, text, html: null };
}
export function validateDefinition(body) {
  if (!body || !["email", "sms", "whatsapp"].includes(body.channel))
    throw bad("Canal invalide.");
  const format = body.format || "text";
  if (
    !["text", "html"].includes(format) ||
    (format === "html" && body.channel !== "email")
  )
    throw bad("Le HTML est réservé aux e-mails.");
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject || subject.length > 180 || /[\r\n\x00]/.test(subject))
    throw bad("Objet requis, 180 caractères maximum.");
  let message = typeof body.message === "string" ? body.message.trim() : "";
  if (
    !message ||
    message.length >
      (body.channel === "sms"
        ? 1500
        : body.channel === "whatsapp"
          ? 3500
          : 50000)
  )
    throw bad("Message vide ou trop long pour ce canal.");
  validateTokens(subject);
  validateTokens(message);
  if (format === "html") {
    message = cleanEmailHtml(message);
    if (!convert(message).trim() && !message.includes("<img"))
      throw bad("Le message HTML est vide après nettoyage.");
  }
  const assets = Array.isArray(body.asset_ids)
    ? [...new Set(body.asset_ids)]
    : [];
  if (
    assets.length > 8 ||
    assets.some(
      (id) => typeof id !== "string" || !/^\d+-[a-f0-9-]{36}$/.test(id),
    ) ||
    (body.channel !== "email" && assets.length)
  )
    throw bad("Images importées invalides.");
  for (const match of message.matchAll(/cid:cashpay-([\da-f-]{36})/gi))
    if (!assets.some((id) => id.endsWith(match[1])))
      throw bad("Une image du message n’a pas été importée.");
  return { channel: body.channel, subject, message, format, asset_ids: assets };
}
