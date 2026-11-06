import jwt from "jsonwebtoken";
import { deny } from "./staff-access.js";
/** Only fixed, existing service endpoints are relayed. No browser-supplied URL or identity. */
export async function serviceRequest(
  config,
  actor,
  kind,
  query = {},
  body,
  fetchImpl = fetch,
) {
  if (actor.role !== "Admin") throw deny();
  if (!["tv", "claims"].includes(kind)) throw deny("Service invalide.", 400);
  if (!config.services?.secret)
    throw deny(
      "Configurer JWT_SECRET du backend CashPay Web pour le traitement des services.",
      503,
    );
  const base = new URL(config.services.origin);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/" ||
    !(
      base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
    )
  )
    throw deny(
      "CASH_PAY_APP_URL doit être une origine HTTPS ou loopback privée.",
      503,
    );
  const target = new URL(
    "/api/v1/admin/" +
      (kind === "tv" ? "tv-subscriptions" : "international-claims"),
    base,
  );
  if (body === undefined) {
    const page = Number(query.page || 0);
    if (!Number.isInteger(page) || page < 0 || page > 10000)
      throw deny("Page invalide.", 400);
    target.searchParams.set("page", String(page));
    if (kind === "tv")
      target.searchParams.set("status", String(query.status || "pending"));
  }
  const token = jwt.sign(
    { id: Number(actor.id), id_wallet: actor.id_wallet, role: "Admin" },
    config.services.secret,
    { algorithm: "HS256", expiresIn: 60 },
  );
  let response;
  try {
    response = await fetchImpl(target, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw deny(
      "Backend CashPay indisponible. Avant de réessayer une validation, actualisez son statut.",
      503,
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw deny(
      "Réponse CashPay invalide. Vérifiez le déploiement des routes de services.",
      503,
    );
  }
  if (!response.ok || result.success !== true)
    throw deny(
      result.error || "Traitement CashPay refusé.",
      response.status === 401
        ? 503
        : response.status >= 400
          ? response.status
          : 400,
    );
  return result;
}
