# Nominations et communications

Les menus **Nominations** et **Communications** sont réservés aux Admins actifs. Les API vérifient le rôle, la session, l’origine et le CSRF ; les opérations définitives exigent le PIN Admin. Le Gestionnaire de compte ne peut ni consulter ces campagnes ni nommer des utilisateurs.

## Installation préalable dans Adminer

Exécuter [sql/admin-communications.sql](sql/admin-communications.sql) dans le schéma configuré, avant de redémarrer cette version. Le script découvre le véritable type enum de `users.role` et ajoute, si nécessaire, `Client`, `Agent`, `SuperAgent`, `SubSuperAgent`, `Admin`, `PartnerB2B`, `AccountManager`. Il crée deux tables : `admin_communications` et `admin_message_deliveries`, avec leurs index. Il ne supprime aucune donnée et n’ajoute aucune colonne à `users`. Aucun DDL n’est exécuté automatiquement par l’application.

L’exécution nécessite les droits du propriétaire du type et du schéma. Si le compte applicatif diffère du propriétaire des nouvelles tables, lui accorder SELECT, INSERT et UPDATE sur ces tables et USAGE sur la séquence de `admin_message_deliveries`. Les droits existants sur les utilisateurs, abonnements Agent, partenaires, notifications et journal restent nécessaires. Une installation manquante bloque les mutations concernées avec une erreur explicite, sans enregistrer une modification partielle.

## Nominations

La fiche utilisateur permet de choisir un rôle réellement installé, un pays, une province et un motif. Le pays est obligatoire pour Agent, SuperAgent, SubSuperAgent et AccountManager ; la province est obligatoire pour SubSuperAgent. Un Admin ne peut pas changer son propre rôle. Les comptes inactifs et les changements concurrents sont refusés. Admin et AccountManager nécessitent une adresse e-mail valide pour le portail OTP.

La nomination Agent ouvre une période offerte explicite de 1 à 365 jours dans `agent_subscriptions`, sans débit du portefeuille. Une échéance existante plus longue est conservée. Quitter le rôle Agent annule son abonnement et son renouvellement automatique. La nomination Partenaire prépare le véritable compte B2B ; quitter ce rôle révoque ses clés API sans effacer les activités ni les soldes. Les clés ne sont jamais envoyées par mail. Les nominations inter-agents nécessitent leur workflow d’affectation métier distinct et ne sont pas proposées par cet écran général.

La nomination, son audit et les notifications sont enregistrés dans la même transaction. Le titulaire reçoit une notification interne et un e-mail mis en file ; l’Admin reçoit une copie d’activité distincte. Les mises à jour de clients, activations B2B et modifications de frais/taux mettent également leurs avis e-mail en file. Les simples consultations et prévisualisations ne déclenchent pas d’e-mail.

## Composition personnalisée

Sélectionner e-mail, SMS ou WhatsApp, puis filtrer les destinataires par pays, rôle, statut ou liste d’ID Wallet. La limite est de 10 000 comptes par campagne, avec 2 000 ID Wallet explicites au maximum. La prévisualisation enregistre un brouillon et trois exemples ; aucun message n’est envoyé avant confirmation avec le PIN Admin. Un brouillon doit être confirmé dans les trente minutes.

Raccourcis disponibles : `{{first_name}}`, `{{last_name}}`, `{{wallet_id}}`, `{{email}}`, `{{phone}}`, `{{country}}`, `{{role}}`, `{{date}}`, `{{balances}}` et `{{balance.USD}}` (ou une autre devise disponible). Chaque destinataire reçoit uniquement ses propres données. Les soldes sont des valeurs décimales exactes relevées à la prévisualisation, avec leur date de lecture ; ils ne sont pas recalculés à l’envoi. Les raccourcis inconnus sont refusés. Aucun raccourci PIN ou secret n’est fourni.

L’e-mail accepte du texte ou du HTML importé, nettoyé des scripts et attributs dangereux. Il reprend l’en-tête, le logo et le pied de page CashPay existants, avec une alternative texte. Les images JPEG, PNG et WebP importées sont réencodées et jointes par CID : huit images maximum, 6 Mo par fichier avant traitement. Les fichiers restent privés dans `ADMIN_STATE_DIR/communication-assets`. Préserver ce répertoire entre les déploiements. Chaque e-mail est envoyé à un seul destinataire, sans CC/BCC.

## File et suivi

Les brouillons, messages personnalisés et résultats sont persistés en PostgreSQL. Le worker reprend les messages en attente après redémarrage. Les appels fournisseurs se font hors transaction SQL. L’interface distingue attente, traitement, accepté par le fournisseur, échec, résultat incertain, contact manquant et annulation.

« Accepté » ne prouve ni la remise ni la lecture. Un timeout ou une interruption après un possible envoi produit un résultat incertain, sans relance automatique. Une relance manuelle exige le PIN et concerne uniquement les échecs explicites. Annuler arrête les messages encore en attente ; cela ne rappelle pas ceux déjà envoyés. Le délai d’arrêt PM2 laisse au worker le temps de terminer ses requêtes.

Les transports utilisent les variables SMTP, Dream Digital et WhatsApp Cloud API existantes. WhatsApp utilise ici l’envoi texte : les restrictions Meta de fenêtre de conversation et de modèles approuvés continuent de s’appliquer. Une campagne hors des conditions autorisées peut être refusée par Meta ; le suivi affiche ce refus. Cette version ne prétend pas fournir une campagne de modèles WhatsApp approuvés.

## Mise à jour VPS

Après exécution du SQL dans Adminer, dans le clone admin uniquement :

```bash
cd /var/www/caspay-all/admin
git pull --ff-only origin codex/admin-dashboard
npm ci --ignore-scripts
npm run check
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save
curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:8010/healthz
```

Conserver `.env`, `ADMIN_SESSION_SECRET` et `ADMIN_STATE_DIR`. Le contrôle `/healthz` confirme le serveur HTTP ; il ne certifie pas les identifiants des fournisseurs ni la remise des messages.

## Vérifications de livraison

Essais SQL/API et Chromium desktop/mobile sur base isolée : rôles et périmètres, cycle Agent/B2B, audit et rollback atomiques, droits Gestionnaire, PIN/CSRF, HTML et images, soldes individualisés, campagne de 1 000 destinataires, reprise après redémarrage sans renvoi incertain, annulation et relance des échecs. Les adaptateurs SMTP/SMS/WhatsApp ont été vérifiés avec transports interceptés. Les régressions inscription, certificat, cartes, Gestionnaire et tarification passent. Aucun fournisseur réel, destinataire réel ou base de production n’a été utilisé. Les scénarios restent hors du dépôt de production.
