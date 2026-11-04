# Connexion Admin par e-mail, OTP et PIN

Le rôle existant doit être `Admin`, le statut actif et `users.pin_hash` configuré. Aucun changement de schéma SQL requis. Le service reste en lecture seule sur la base partagée.

## Mise à jour de l’installation existante

Exécuter sur le VPS, dans le clone indiqué. Si Git refuse une mise à jour en raison de modifications locales, les préserver avant de continuer.

```bash
bash -eu <<'UPDATE'
cd /var/www/caspay-all/admin
git pull --ff-only origin codex/admin-dashboard
npm ci --ignore-scripts
npm run check
node deploy/configure-mail.js /var/www/cashpay-all/wallet/.env
pm2 restart cashpay-admin --update-env
curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:8010/healthz
UPDATE
```

L’import SMTP copie seulement les quatre paramètres SMTP existants. Il conserve les paramètres PostgreSQL et le secret admin, crée une sauvegarde privée de `.env`, refuse des paramètres SMTP différents déjà configurés et n’affiche aucun secret. Les sauvegardes sont exclues de Git. L’outil exige Node 22.9 minimum. Ne pas copier les secrets JWT client.

Nginx et les autres processus ne sont pas modifiés. Ouvrir ensuite https://admin.cashpay-all.com/login, saisir l’e-mail Admin, le code reçu, puis le PIN existant. Vérifier la réception réelle de l’e-mail et l’accès au tableau de bord. `/healthz` confirme uniquement le processus, pas SMTP ni PostgreSQL.

Les sessions valides survivent au redémarrage PM2 si le secret et `.runtime` restent identiques. Durée absolue configurable par `ADMIN_SESSION_HOURS` (défaut 8), inactivité par `ADMIN_SESSION_IDLE_MINUTES` (défaut 60). Les demandes OTP inachevées doivent être recommencées après redémarrage. La persistance est conçue pour une instance PM2 unique.

## Validation de livraison

Syntaxe JavaScript, essais SQL/API sur PGlite isolé et parcours Chromium e-mail → OTP → PIN → tableau de bord → déconnexion. Vérifications des refus de rôles, de l’ordre des étapes, des codes incorrects et réutilisés, de l’échec d’envoi, de la persistance/révocation/expiration des sessions et de la préservation de l’environnement. Les doubles de transport utilisés pour ces essais restent hors Git. Aucun e-mail réel ni accès à la base de production pendant les essais ; la livraison ne certifie pas la configuration SMTP du VPS.
