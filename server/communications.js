import crypto from "node:crypto";
import { adminPin } from "./client-management.js";
import { deny } from "./staff-access.js";
import { readSnapshot } from "./db.js";
import countries from "./registration-countries.json" with { type: "json" };
import {
  validateDefinition,
  renderMessage,
  messageTokens,
} from "./message-content.js";
import {
  addDelivery,
  requireMessageSchema,
  queueActionNotice,
  messageDestination,
} from "./message-outbox.js";
import { createCommunicationAssets } from "./communication-assets.js";
import { createMessageDispatcher, emailEnvelope } from "./message-dispatch.js";
import { escape } from "./mailer.js";

const bad = (message) => deny(message, 400);
const idValue = (id) => {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw bad("Communication invalide.");
  return id;
};
const stateCounts = `COUNT(d.id) FILTER(WHERE d.status='pending')::int AS pending,
 COUNT(d.id) FILTER(WHERE d.status='sending')::int AS sending,COUNT(d.id) FILTER(WHERE d.status='accepted')::int AS accepted,
 COUNT(d.id) FILTER(WHERE d.status='failed')::int AS failed,COUNT(d.id) FILTER(WHERE d.status='unknown')::int AS unknown,
 COUNT(d.id) FILTER(WHERE d.status='skipped')::int AS skipped,COUNT(d.id) FILTER(WHERE d.status='cancelled')::int AS cancelled`;
async function transaction(pool, work) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN READ WRITE");
    await db.query("SET LOCAL lock_timeout='3s'");
    const value = await work(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
function normalizeFilters(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw bad("Filtres invalides.");
  const country = String(raw.country || "")
      .trim()
      .toUpperCase(),
    role = String(raw.role || "").trim(),
    status = String(raw.status || "active").trim();
  if (country && !countries.some((c) => c.code === country))
    throw bad("Pays invalide.");
  if (role.length > 60 || status.length > 40)
    throw bad("Rôle ou état invalide.");
  const walletIds = Array.isArray(raw.wallet_ids)
    ? [...new Set(raw.wallet_ids.map((v) => String(v).trim()).filter(Boolean))]
    : [];
  if (
    walletIds.length > 2000 ||
    walletIds.some((v) => v.length > 64 || /[\x00-\x1f]/.test(v))
  )
    throw bad("Liste limitée à 2 000 ID Wallet.");
  return { country, role, status, wallet_ids: walletIds };
}
async function audience(db, filters) {
  const values = [],
    where = [];
  const bind = (v) => {
    values.push(v);
    return "$" + values.length;
  };
  if (filters.country) {
    const country = countries.find((c) => c.code === filters.country);
    where.push(
      `(LOWER(u.country)=LOWER(${bind(country.name)}) OR UPPER(u.country)=${bind(country.code)})`,
    );
  }
  if (filters.role) where.push(`u.role::text=${bind(filters.role)}`);
  if (filters.status !== "all")
    where.push(`LOWER(u.status::text)=LOWER(${bind(filters.status)})`);
  if (filters.wallet_ids.length)
    where.push(`u.id_wallet=ANY(${bind(filters.wallet_ids)}::text[])`);
  const { rows } = await db.query(
    `SELECT u.id,u.id_wallet,u.first_name,u.last_name,u.email,u.phone,u.country,u.role::text AS role,
 CASE WHEN w.user_id IS NULL OR jsonb_typeof(w.balances::jsonb)<>'object' THEN NULL ELSE
 (SELECT COALESCE(jsonb_object_agg(b.key,b.value),'{}'::jsonb) FROM jsonb_each_text(w.balances::jsonb) b) END AS balance_values
 FROM users u LEFT JOIN wallets w ON w.user_id=u.id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.id LIMIT 10001`,
    values,
  );
  if (rows.length > 10000)
    throw bad("Cible supérieure à 10 000 utilisateurs. Affinez les filtres.");
  if (!rows.length) throw bad("Aucun utilisateur ne correspond aux filtres.");
  return rows;
}
function assertAdmin(actor) {
  if (actor.role !== "Admin") throw deny();
}
export function createCommunications({
  pool,
  config,
  dispatch = createMessageDispatcher(config),
}) {
  const assets = createCommunicationAssets(config);
  let timer = null,
    active = null,
    stopping = false,
    backoffUntil = 0,
    workerError = null,
    lastTick = null;
  const api = {
    assets,
    async catalog() {
      return readSnapshot(pool, async (db) => {
        const options = await db.query(
          "SELECT DISTINCT role::text AS role,status::text AS status FROM users ORDER BY role,status",
        );
        const currencies = await db.query(
          "SELECT DISTINCT b.key AS code FROM wallets w CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(w.balances::jsonb)='object' THEN w.balances::jsonb ELSE '{}'::jsonb END) b(key) ORDER BY b.key",
        );
        let ready = true;
        try {
          await requireMessageSchema(db);
        } catch (error) {
          if (error.status === 503) ready = false;
          else throw error;
        }
        return {
          ready,
          sql: "docs/sql/admin-communications.sql",
          countries,
          roles: [...new Set(options.rows.map((r) => r.role))],
          statuses: [...new Set(options.rows.map((r) => r.status))],
          tokens: [
            ...messageTokens,
            ...currencies.rows
              .filter((r) => /^[A-Z0-9_]{2,16}$/.test(r.code))
              .map((r) => "balance." + r.code),
          ],
        };
      });
    },
    async preview(actor, body) {
      assertAdmin(actor);
      const definition = validateDefinition(body),
        filters = normalizeFilters(body.filters);
      const attached = await assets.attachments(actor.id, definition.asset_ids);
      const previews = [];
      const id = crypto.randomUUID(),
        stamp = new Date().toISOString();
      const balanceUsed = /\{\{\s*balances?(?:\.[A-Z0-9_]+)?\s*\}\}/.test(
        definition.message + definition.subject,
      );
      const summary = await transaction(pool, async (db) => {
        await requireMessageSchema(db);
        const current = (
          await db.query(
            "SELECT role::text AS role FROM users WHERE id=$1 AND LOWER(status::text)='active' FOR SHARE",
            [actor.id],
          )
        ).rows[0];
        if (current?.role !== "Admin") throw deny();
        const users = await audience(db, filters);
        await db.query(
          `INSERT INTO admin_communications(id,created_by,kind,channel,subject,message,format,filters,asset_ids,status,total) VALUES($1,$2,'campaign',$3,$4,$5,$6,$7,$8,'draft',$9)`,
          [
            id,
            actor.id,
            definition.channel,
            definition.subject,
            definition.message,
            definition.format,
            JSON.stringify(filters),
            JSON.stringify(definition.asset_ids),
            users.length,
          ],
        );
        let reachable = 0;
        for (const user of users) {
          const rendered = renderMessage(definition, user, stamp);
          if (balanceUsed) {
            rendered.text += "\n\nSoldes relevés le " + stamp;
            if (rendered.html)
              rendered.html += "<p>Soldes relevés le " + escape(stamp) + "</p>";
          }
          if (
            rendered.subject.length > 500 ||
            rendered.text.length >
              (definition.channel === "sms"
                ? 1500
                : definition.channel === "whatsapp"
                  ? 3500
                  : 100000)
          )
            throw bad(
              "Un message personnalisé dépasse la limite du canal. Réduisez le texte ou les raccourcis.",
            );
          await addDelivery(
            db,
            id,
            user,
            definition.channel,
            rendered.subject,
            rendered.text,
            rendered.html,
          );
          if (messageDestination(user, definition.channel)) reachable++;
          if (previews.length < 3)
            previews.push({
              wallet_id: user.id_wallet,
              first_name: user.first_name || "",
              ...rendered,
            });
        }
        return {
          total: users.length,
          reachable,
          skipped: users.length - reachable,
        };
      });
      for (const preview of previews) {
        preview.html = await emailEnvelope(
          preview.subject,
          preview.html ||
            "<p>" + escape(preview.text).replace(/\n/g, "<br>") + "</p>",
        );
        for (const attachment of attached)
          preview.html = preview.html.replaceAll(
            "cid:" + attachment.cid,
            "data:image/jpeg;base64," + attachment.content.toString("base64"),
          );
      }
      return {
        id,
        ...summary,
        created_at: stamp,
        previews,
        message:
          "Aucun message envoyé. Confirmez cet aperçu avec votre PIN Admin.",
      };
    },
    async start(actor, id, body) {
      assertAdmin(actor);
      idValue(id);
      return transaction(pool, async (db) => {
        await requireMessageSchema(db);
        const fresh = await adminPin(db, actor, body.admin_pin);
        assertAdmin(fresh);
        const campaign = (
          await db.query(
            "SELECT * FROM admin_communications WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (
          !campaign ||
          Number(campaign.created_by) !== Number(actor.id) ||
          campaign.kind !== "campaign"
        )
          throw deny();
        if (campaign.status === "cancelled")
          throw deny("Communication annulée. Créez un nouvel aperçu.", 409);
        if (campaign.status !== "draft")
          return {
            success: true,
            id,
            status: campaign.status,
            total: campaign.total,
          };
        if (Date.now() - new Date(campaign.created_at).getTime() > 30 * 60000)
          throw deny("Aperçu expiré. Générez un nouvel aperçu.", 409);
        const reachable = Number(
          (
            await db.query(
              "SELECT COUNT(*)::int AS count FROM admin_message_deliveries WHERE campaign_id=$1 AND status='pending'",
              [id],
            )
          ).rows[0].count,
        );
        if (!reachable) throw bad("Aucun destinataire joignable sur ce canal.");
        await assets.attachments(campaign.created_by, campaign.asset_ids);
        await db.query(
          "UPDATE admin_communications SET status='queued',started_at=NOW() WHERE id=$1",
          [id],
        );
        await db.query(
          "INSERT INTO super_agent_interventions(admin_user_id,target_user_id,action_type,detail) VALUES($1,NULL,$2,$3)",
          [
            actor.id,
            "MASS_COMMUNICATION_QUEUE",
            JSON.stringify({
              campaign_id: id,
              channel: campaign.channel,
              total: campaign.total,
            }),
          ],
        );
        await queueActionNotice(db, {
          actorId: actor.id,
          subject: "Communication CashPay enregistrée",
          message: `Votre communication « ${campaign.subject} » est en file d’envoi sur ${campaign.channel} pour ${campaign.total} comptes. Consultez le suivi pour connaître les acceptations et échecs.`,
          action: "MASS_COMMUNICATION_QUEUE",
        });
        return { success: true, id, status: "queued", total: campaign.total };
      });
    },
    async list(page = 1) {
      return readSnapshot(pool, async (db) => {
        await requireMessageSchema(db);
        const { rows } = await db.query(
          `SELECT c.id,c.created_by,c.kind,c.channel,c.subject,c.status,c.total,c.created_at,c.started_at,c.completed_at,${stateCounts} FROM admin_communications c LEFT JOIN admin_message_deliveries d ON d.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC,c.id DESC LIMIT 26 OFFSET $1`,
          [(page - 1) * 25],
        );
        return {
          items: rows.slice(0, 25),
          has_more: rows.length > 25,
          page,
          worker: {
            running: !!timer,
            last_error: workerError,
            last_tick: lastTick,
          },
        };
      });
    },
    async detail(id, page = 1) {
      idValue(id);
      return readSnapshot(pool, async (db) => {
        await requireMessageSchema(db);
        const campaign = (
          await db.query(
            "SELECT id,kind,channel,subject,status,total,created_at,created_by FROM admin_communications WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (!campaign) throw deny("Communication introuvable.", 404);
        const { rows } = await db.query(
          `SELECT d.id,d.user_id,u.id_wallet,u.first_name,d.channel,d.destination,d.status,d.attempts,d.provider_id,d.error_code,d.started_at,d.finished_at FROM admin_message_deliveries d JOIN users u ON u.id=d.user_id WHERE d.campaign_id=$1 ORDER BY d.id LIMIT 26 OFFSET $2`,
          [id, (page - 1) * 25],
        );
        return {
          campaign,
          items: rows.slice(0, 25),
          has_more: rows.length > 25,
          page,
        };
      });
    },
    async control(actor, id, body) {
      assertAdmin(actor);
      idValue(id);
      if (!["cancel", "retry_failed"].includes(body.action))
        throw bad("Action invalide.");
      return transaction(pool, async (db) => {
        await requireMessageSchema(db);
        const fresh = await adminPin(db, actor, body.admin_pin);
        assertAdmin(fresh);
        const row = (
          await db.query(
            "SELECT status FROM admin_communications WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!row) throw deny("Communication introuvable.", 404);
        if (body.action === "retry_failed") {
          if (["cancelled", "draft"].includes(row.status))
            throw deny("Cette communication ne peut pas être relancée.", 409);
          const updated = await db.query(
            "UPDATE admin_message_deliveries SET status='pending',error_code=NULL,started_at=NULL,finished_at=NULL WHERE campaign_id=$1 AND status='failed'",
            [id],
          );
          if (!updated.rowCount)
            throw bad(
              "Aucun échec certain à relancer. Les résultats incertains exigent une vérification fournisseur.",
            );
          await db.query(
            "UPDATE admin_communications SET status='queued',completed_at=NULL WHERE id=$1",
            [id],
          );
        } else {
          await db.query(
            "UPDATE admin_message_deliveries SET status='cancelled',finished_at=NOW() WHERE campaign_id=$1 AND status='pending'",
            [id],
          );
          await db.query(
            "UPDATE admin_communications SET status='cancelled',completed_at=NOW() WHERE id=$1",
            [id],
          );
        }
        await db.query(
          "INSERT INTO super_agent_interventions(admin_user_id,target_user_id,action_type,detail) VALUES($1,NULL,$2,$3)",
          [
            actor.id,
            "COMMUNICATION_CONTROL",
            JSON.stringify({ campaign_id: id, action: body.action }),
          ],
        );
        await queueActionNotice(db, {
          actorId: actor.id,
          subject: "Suivi de communication CashPay",
          message:
            body.action === "cancel"
              ? "Les envois en attente de la communication " +
                id +
                " ont été annulés. Les envois déjà partis ne peuvent pas être rappelés."
              : "Les échecs certains de la communication " +
                id +
                " ont été remis en file. Les résultats incertains n’ont pas été relancés.",
          action: "COMMUNICATION_CONTROL",
        });
        return { success: true };
      });
    },
    async tick() {
      if (stopping || Date.now() < backoffUntil) return;
      const batch = await transaction(pool, async (db) => {
        await requireMessageSchema(db);
        await db.query(
          "UPDATE admin_message_deliveries SET status='unknown',error_code='interrupted_send',finished_at=NOW() WHERE status='sending' AND started_at<NOW()-INTERVAL '5 minutes'",
        );
        const result =
          await db.query(`WITH selected AS (SELECT d.id FROM admin_message_deliveries d JOIN admin_communications c ON c.id=d.campaign_id WHERE d.status='pending' AND c.status IN ('queued','running') ORDER BY CASE WHEN c.kind='action' THEN 0 ELSE 1 END,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 3)
     UPDATE admin_message_deliveries d SET status='sending',started_at=NOW(),attempts=attempts+1 FROM selected WHERE d.id=selected.id RETURNING d.*`);
        for (const delivery of result.rows)
          await db.query(
            "UPDATE admin_communications SET status='running' WHERE id=$1 AND status='queued'",
            [delivery.campaign_id],
          );
        return result.rows;
      });
      await Promise.all(
        batch.map(async (delivery) => {
          let result;
          let images = [];
          try {
            const campaign = (
              await pool.query(
                "SELECT created_by,asset_ids FROM admin_communications WHERE id=$1",
                [delivery.campaign_id],
              )
            ).rows[0];
            images =
              delivery.channel === "email"
                ? await assets.attachments(
                    campaign.created_by,
                    campaign.asset_ids,
                  )
                : [];
          } catch {
            result = { status: "failed", code: "message_assets_unavailable" };
          }
          if (!result)
            try {
              result = await dispatch(delivery, images);
            } catch {
              result = { status: "unknown", code: "send_result_unknown" };
            }
          if (!["accepted", "failed", "unknown"].includes(result?.status))
            result = { status: "unknown", code: "provider_result_unconfirmed" };
          await transaction(pool, (db) =>
            db.query(
              "UPDATE admin_message_deliveries SET status=$2,provider_id=$3,error_code=$4,finished_at=NOW() WHERE id=$1 AND status='sending'",
              [
                delivery.id,
                result.status,
                result.providerId
                  ? String(result.providerId).slice(0, 500)
                  : null,
                result.code ? String(result.code).slice(0, 80) : null,
              ],
            ),
          );
        }),
      );
      await transaction(pool, (db) =>
        db.query(
          "UPDATE admin_communications c SET status='completed',completed_at=NOW() WHERE c.status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM admin_message_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('pending','sending'))",
        ),
      );
      workerError = null;
      lastTick = new Date().toISOString();
    },
    startWorker() {
      if (timer) return;
      stopping = false;
      timer = setInterval(() => {
        if (active || stopping) return;
        active = api
          .tick()
          .catch((error) => {
            backoffUntil = Date.now() + 30000;
            workerError =
              "File temporairement indisponible : vérifier la migration, les droits SQL et PostgreSQL.";
            console.error(
              "[communications worker]",
              error.code || "unavailable",
            );
          })
          .finally(() => {
            active = null;
          });
      }, 1000);
      timer.unref();
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      await active;
    },
  };
  return api;
}
