import { readFile } from "node:fs/promises";
import { smtpTransport, escape } from "./mailer.js";
export async function emailEnvelope(subject, body) {
  const base = await readFile(
    new URL("./email-templates/_base.html", import.meta.url),
    "utf8",
  );
  return base
    .split("{{{body}}}")
    .map((part) =>
      part.replace(/\{\{(\w+)\}\}/g, (_all, key) =>
        escape({ subject, year: new Date().getFullYear() }[key] || ""),
      ),
    )
    .join(body);
}
export function createMessageDispatcher(config) {
  let transport;
  return async (delivery, attachments = []) => {
    let submitted = false;
    try {
      if (delivery.channel === "email") {
        if (!config.smtp?.host || !config.smtp.user || !config.smtp.password)
          return { status: "failed", code: "email_not_configured" };
        transport ||= smtpTransport(config);
        const html = await emailEnvelope(
          delivery.subject,
          delivery.message_html ||
            "<p>" +
              escape(delivery.message_text).replace(/\n/g, "<br>") +
              "</p>",
        );
        submitted = true;
        const result = await transport.sendMail({
          from: { name: "CashPay All", address: config.smtp.user },
          to: delivery.destination,
          subject: delivery.subject,
          text: delivery.message_text,
          html,
          attachments,
        });
        return result.accepted?.some(
          (value) =>
            String(
              typeof value === "string" ? value : value.address,
            ).toLowerCase() === delivery.destination.toLowerCase(),
        )
          ? { status: "accepted", providerId: result.messageId }
          : { status: "failed", code: "email_rejected" };
      }
      if (delivery.channel === "sms") {
        if (!config.sms?.url || !config.sms.id || !config.sms.password)
          return { status: "failed", code: "sms_not_configured" };
        const url = new URL(config.sms.url);
        if (url.protocol !== "https:")
          return { status: "failed", code: "sms_https_required" };
        for (const [key, value] of Object.entries({
          api_id: config.sms.id,
          api_password: config.sms.password,
          sms_type: "T",
          encoding: "T",
          sender_id: config.sms.sender,
          phonenumber: delivery.destination,
          textmessage: delivery.message_text,
        }))
          url.searchParams.set(key, value);
        submitted = true;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        const raw = await response.text();
        let value;
        try {
          value = JSON.parse(raw);
        } catch {}
        const status = String(
          value?.status ?? value?.Status ?? "",
        ).toUpperCase();
        if (response.status >= 500)
          return { status: "unknown", code: "sms_http_uncertain" };
        if (
          !response.ok ||
          value?.error ||
          /\b(error|erreur|invalid|insufficient|denied|failed|rejected)\b/i.test(
            raw,
          ) ||
          ["F", "E", "FAILED", "ERROR"].includes(status)
        )
          return { status: "failed", code: "sms_rejected" };
        return ["S", "SUCCESS", "OK", "SENT"].includes(status) ||
          value?.success === true
          ? {
              status: "accepted",
              providerId: String(value?.message_id || value?.id || "") || null,
            }
          : { status: "unknown", code: "sms_response_unconfirmed" };
      }
      if (
        !config.whatsapp?.token ||
        !/^\d+$/.test(config.whatsapp.phoneId || "")
      )
        return { status: "failed", code: "whatsapp_not_configured" };
      submitted = true;
      const response = await fetch(
        "https://graph.facebook.com/v23.0/" +
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
            recipient_type: "individual",
            to: delivery.destination,
            type: "text",
            text: { preview_url: false, body: delivery.message_text },
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (response.status >= 500)
        return { status: "unknown", code: "whatsapp_http_uncertain" };
      const body = await response.json();
      return response.ok && body.messages?.[0]?.id
        ? { status: "accepted", providerId: body.messages[0].id }
        : { status: "failed", code: "whatsapp_rejected" };
    } catch (error) {
      if (!submitted)
        return { status: "failed", code: "message_preparation_failed" };
      if (
        [
          "EAUTH",
          "ECONNECTION",
          "ENOTFOUND",
          "ECONNREFUSED",
          "EENVELOPE",
        ].includes(error.code)
      )
        return { status: "failed", code: "transport_not_connected" };
      return {
        status: "unknown",
        code:
          error.name === "TimeoutError"
            ? "provider_timeout"
            : "provider_result_unknown",
      };
    }
  };
}
