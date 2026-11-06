-- Exécuter dans le schéma PostgreSQL configuré pour Cashpay Admin.
-- Rôles déjà pris en charge par Cashpay Web ; aucun champ de users ajouté ni aucune donnée supprimée.
DO $cashpay_roles$
DECLARE role_type regtype; label text;
BEGIN
  SELECT a.atttypid::regtype INTO role_type FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
  WHERE a.attrelid='users'::regclass AND a.attname='role' AND t.typtype='e' AND NOT a.attisdropped;
  IF role_type IS NOT NULL THEN
    FOREACH label IN ARRAY ARRAY['Client','Agent','SuperAgent','SubSuperAgent','Admin','PartnerB2B','AccountManager'] LOOP
      EXECUTE format('ALTER TYPE %s ADD VALUE IF NOT EXISTS %L',role_type,label);
    END LOOP;
  END IF;
END
$cashpay_roles$;
BEGIN;
CREATE TABLE IF NOT EXISTS admin_communications (
  id UUID PRIMARY KEY,
  created_by BIGINT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('campaign','action')),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('text','html')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('draft','queued','running','completed','cancelled')),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS admin_message_deliveries (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES admin_communications(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  destination TEXT,
  subject TEXT NOT NULL,
  message_text TEXT NOT NULL,
  message_html TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','sending','accepted','failed','unknown','skipped','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  provider_id TEXT,
  error_code TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE (campaign_id,user_id,channel,destination)
);
CREATE INDEX IF NOT EXISTS admin_communications_created_idx ON admin_communications(created_at DESC,id);
CREATE INDEX IF NOT EXISTS admin_message_deliveries_pending_idx ON admin_message_deliveries(status,id);
CREATE INDEX IF NOT EXISTS admin_message_deliveries_campaign_idx ON admin_message_deliveries(campaign_id,id);
COMMIT;
