# Demandes TV et réclamations internationales

Le menu **Demandes et consultations** est réservé aux Admins, côté interface et API. Il affiche les abonnements TV payés avec opérateur, décodeur, montant/devise, statut du paiement et état d’activation. Les filtres proposent attente, actif, annulé/remboursé et tous. Activation et rejet exigent le PIN Admin ; l’activation exige aussi la référence réelle du fournisseur. Le moteur CashPay Web existant exécute l’opération et son historique, sans réimplémentation financière dans le portail.

La section Western Union / MoneyGram / Ria montre les devises demandées, le statut, l’agent responsable et le journal des consultations/réservations/vérifications/décisions avec nom, ID Wallet et date. La pagination parcourt aussi le journal. Un dossier en attente non pris en charge peut être approuvé administrativement. Cela autorise son traitement mais ne crédite aucun portefeuille. Les dossiers réservés restent soumis au moteur inter-agent, à ses contrôles d’identité et à ses fonds réservés.

Les traitements TV et leurs journaux sont également consultables. Les réponses viennent des tables réelles ; une panne ou un schéma manquant est affiché comme une erreur, sans liste inventée. Après un timeout lors d’une validation, actualiser d’abord le statut avant de répéter l’action.

## Configuration

Conserver le fichier `.env` existant. Le service lit `CASH_PAY_APP_URL` (par exemple l’origine loopback du backend existant, port 8002) et `JWT_SECRET` déjà utilisé par CashPay Web. Si ce dernier manque, seules ces fonctions affichent une erreur de configuration ; aucun accès anonyme de remplacement. `ADMIN_SESSION_SECRET` reste distinct et ne doit pas être changé pour cette intégration.

Les API du portail vérifient session, rôle Admin, origine, CSRF et PIN actuel. Le serveur signe pour son propre utilisateur un jeton de 60 secondes, jamais fourni au navigateur. Le backend relit le compte et les droits en base. Les destinations sont limitées aux deux routes fixes `/api/v1/admin/tv-subscriptions` et `/api/v1/admin/international-claims`, sur une origine HTTPS ou loopback privée ; les redirections ne sont pas suivies. Aucun URL ou identifiant d’opérateur transmis par le navigateur ne choisit le moteur ou l’Admin exécutant.

## Mise à jour

Déployer d’abord CashPay Web et ses deux nouvelles routes sur la branche `codex/super-agent-operations`, puis mettre à jour le clone Admin :

```bash
cd /var/www/caspay-all/admin
git pull --ff-only origin codex/admin-dashboard
npm run check
pm2 restart cashpay-admin --update-env
```

Aucune nouvelle dépendance npm, table ou colonne dans ce lot. Les tables existantes `tv_subscription_fees`, `subscriptions`, `inter_claim_cases` et `inter_claim_audit` doivent être installées. Les scripts déjà présents dans CashPay Web sont détaillés dans [le guide USSD](https://github.com/Finuseco/cashpay_web/blob/codex/super-agent-operations/docs/20261106-ussd-tv-agent-admin.md). Ne pas exécuter les paiements ou les migrations à partir d’une base de démonstration.

Vérifications : API du portail et Chromium mobile/desktop, refus Gestionnaire, PIN/CSRF, identité du jeton serveur, traitement manuel avec référence, approbation administrative et affichage sûr des journaux. Les réponses amont sont interceptées hors du dépôt pour ces essais navigateur ; les moteurs/SQL backend sont vérifiés séparément sur PostgreSQL isolé. Aucun service de production ou opérateur GSM utilisé.
