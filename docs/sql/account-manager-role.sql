-- À exécuter dans Adminer sur le schéma Cashpay, séparément de toute nomination.
-- Ajoute la valeur au véritable type enum de users.role sans deviner son nom.
DO $$
DECLARE role_type text; role_schema text; role_kind "char";
BEGIN
  SELECT t.typname,n.nspname,t.typtype INTO role_type,role_schema,role_kind
  FROM pg_attribute a
  JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace cn ON cn.oid=c.relnamespace
  JOIN pg_type t ON t.oid=a.atttypid
  JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE c.oid=to_regclass('users') AND a.attname='role' AND NOT a.attisdropped;
  IF role_type IS NULL THEN RAISE EXCEPTION 'Colonne users.role introuvable dans le schéma sélectionné'; END IF;
  IF role_kind='e' THEN
    EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',role_schema,role_type,'AccountManager');
  ELSE
    RAISE NOTICE 'users.role n’est pas un enum : vérifier ses contraintes CHECK avant la nomination. Aucune contrainte modifiée.';
  END IF;
END $$;
