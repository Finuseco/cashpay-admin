import { readFile } from "node:fs/promises";
import { smtpTransport, escape } from "./mailer.js";
export function createWelcomeSender(config) {
  return async ({
    email,
    phone,
    full_name,
    id_wallet,
    pin,
    kind = "welcome",
    price,
    currency,
    reference,
    brand,
    request_id,
  }) => {
    const cardOrder = kind === "card-order";
    const subject = cardOrder
      ? "Votre commande de carte CashPay All"
      : "Votre inscription CashPay All";
    const text = cardOrder
      ? `CashPay All : carte physique ${brand.toUpperCase()} commandée. Tarif débité : ${price} ${currency}. Référence : ${reference}. Demande #${request_id} en attente de validation fournisseur. Aucun PIN ne vous sera demandé par message.`
      : `Bienvenue chez CashPay All, ${full_name}. Votre ID Wallet : ${id_wallet}. Votre PIN initial : ${pin}. Changez-le dès votre première connexion. Ne le partagez pas.`;
    const results = {};
    const emailTask = (async () => {
      try {
        const [base, body] = await Promise.all([
          readFile(
            new URL("./email-templates/_base.html", import.meta.url),
            "utf8",
          ),
          readFile(
            new URL(
              cardOrder
                ? "./email-templates/card-order.html"
                : "./email-templates/welcome.html",
              import.meta.url,
            ),
            "utf8",
          ),
        ]);
        const values = {
          userName: full_name,
          walletId: id_wallet,
          pin,
          loginUrl: config.mediaOrigin + "/login",
          signature: "L’équipe CashPay All",
          subject,
          price,
          currency,
          reference,
          brand,
          requestId: request_id,
          year: new Date().getFullYear(),
        };
        const html = base
          .replace("{{{body}}}", body)
          .replace(/\{\{(\w+)\}\}/g, (_match, key) => escape(values[key]));
        const result = await smtpTransport(config).sendMail({
          from: { name: "CashPay All", address: config.smtp.user },
          to: email,
          subject,
          text,
          html,
        });
        results.email = result.accepted?.some(
          (value) =>
            String(
              typeof value === "string" ? value : value.address,
            ).toLowerCase() === email.toLowerCase(),
        )
          ? "accepted"
          : "failed";
      } catch {
        results.email = "failed";
      }
    })();
    const smsTask = (async () => {
      if (config.sms?.url && config.sms.id && config.sms.password) {
        try {
          const url = new URL(config.sms.url);
          if (url.protocol !== "https:") throw Error("HTTPS requis");
          for (const [key, value] of Object.entries({
            api_id: config.sms.id,
            api_password: config.sms.password,
            sms_type: "T",
            encoding: "T",
            sender_id: config.sms.sender,
            phonenumber: phone.replace(/\D/g, ""),
            textmessage: text,
          }))
            url.searchParams.set(key, value);
          const response = await fetch(url, {
            signal: AbortSignal.timeout(10000),
          });
          const body = await response.text();
          let value;
          try {
            value = JSON.parse(body);
          } catch {}
          const status = String(
            value?.status ?? value?.Status ?? "",
          ).toUpperCase();
          results.sms =
            !response.ok ||
            value?.error ||
            /\b(error|erreur|invalid|insufficient|denied|failed|rejected)\b/i.test(
              body,
            ) ||
            ["F", "E", "FAILED", "ERROR"].includes(status)
              ? "failed"
              : ["S", "SUCCESS", "OK", "SENT"].includes(status) ||
                  value?.success === true
                ? "accepted"
                : "unconfirmed";
        } catch {
          results.sms = "failed";
        }
      } else results.sms = "not_configured";
    })();
    const whatsappTask = (async () => {
      if (
        config.whatsapp?.token &&
        /^\d+$/.test(config.whatsapp.phoneId || "")
      ) {
        try {
          const response = await fetch(
            "https://graph.facebook.com/v22.0/" +
              config.whatsapp.phoneId +
              "/messages",
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + config.whatsapp.token,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: phone.replace(/\D/g, ""),
                type: "text",
                text: { body: text },
              }),
              signal: AbortSignal.timeout(10000),
            },
          );
          const body = await response.json();
          results.whatsapp =
            response.ok && body.messages?.[0]?.id ? "accepted" : "failed";
        } catch {
          results.whatsapp = "failed";
        }
      } else results.whatsapp = "not_configured";
    })();
    await Promise.all([emailTask, smsTask, whatsappTask]);
    return results;
  };
}

export function createCardOrderSender(config) {
  const send = createWelcomeSender(config);
  return (receipt) => send({ ...receipt, kind: "card-order" });
}
