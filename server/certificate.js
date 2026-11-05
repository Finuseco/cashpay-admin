import { readSnapshot } from "./db.js";
import { escape } from "./mailer.js";
export async function registrationCertificate(pool, id) {
  return readSnapshot(pool, async (db) => {
    const { rows } = await db.query(
      "SELECT i.id,i.detail,i.created_at,a.full_name AS actor_name,u.id AS user_id,u.id_wallet,u.full_name,u.email,u.phone,u.country,u.city,u.address,u.account_type,u.profile_photo FROM super_agent_interventions i JOIN users u ON u.id=i.target_user_id LEFT JOIN users a ON a.id=i.admin_user_id WHERE i.target_user_id=$1 AND i.action_type='ACCOUNT_CREATE' ORDER BY i.id LIMIT 1",
      [id],
    );
    if (!rows[0])
      throw Object.assign(
        Error(
          "Aucune inscription de ce compte enregistrée dans le back-office.",
        ),
        { status: 404, expose: true },
      );
    const audit = rows[0];
    let detail;
    try {
      detail = JSON.parse(audit.detail);
    } catch {}
    const snapshot = detail?.registration || audit;
    const data = [
      ["Titulaire", snapshot.full_name],
      ["ID Wallet", snapshot.id_wallet],
      ["Type de compte", snapshot.account_type],
      ["Téléphone", snapshot.phone],
      ["E-mail", snapshot.email],
      ["Pays", snapshot.country],
      ["Province", snapshot.province],
      ["Ville", snapshot.city],
      ["Adresse", snapshot.address],
      ["Date de naissance", snapshot.birth_date],
      ["Nationalité", snapshot.nationality],
    ];
    const photo =
      typeof snapshot.profile_photo === "string" &&
      /^https?:\/\//.test(snapshot.profile_photo)
        ? snapshot.profile_photo
        : null;
    const signature = /^[a-f0-9-]{36}$/.test(detail?.media?.signature || "")
      ? "/api/registration/media/" + detail.media.signature
      : null;
    const date = new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(audit.created_at));
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inscription ${escape(audit.id_wallet)}</title><link rel="stylesheet" href="/assets/css/style.css"><link rel="stylesheet" href="/certificate.css"></head><body><p id="certificate-error" role="alert"></p><div class="print-actions"><button type="button" id="print-certificate" class="btn btn-primary">Imprimer / Enregistrer en PDF A4</button><a class="btn btn-outline-primary" href="/users/${audit.user_id}">Retour au compte</a></div><main><header><h1>CashPay All</h1><h2>Certificat d’inscription</h2><p>Référence : CP-${escape(audit.id_wallet)}-${audit.id}</p><p>Enregistrement du ${escape(date)} UTC</p></header>${photo ? `<img class="portrait" src="${escape(photo)}" alt="Photo du titulaire">` : ""}<dl>${data
      .filter(([, value]) => value)
      .map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`)
      .join(
        "",
      )}</dl><section><h3>Traçabilité</h3><p>Enregistré par : ${escape(audit.actor_name || "Administrateur")}</p><p>Intervention : ${audit.id}</p><p>${detail?.registration ? "Données conservées au moment de l’inscription." : "Réédition selon les données actuelles du compte ; archive d’identité non disponible."}</p></section>${signature ? `<section><h3>Signature recueillie du titulaire</h3><img class="signature" src="${signature}" alt="Signature du titulaire"></section>` : ""}<footer>Ce document atteste l’enregistrement du compte. Il ne constitue ni une validation KYC, ni une preuve de solde, ni un justificatif de paiement. Aucun code PIN n’est imprimé.</footer></main><script src="/certificate.js"></script></body></html>`;
  });
}
