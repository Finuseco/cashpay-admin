# Cashpay Admin — tableau de bord de la base partagée

Back-office indépendant pour **admin.cashpay-all.com**, basé sur la template Corona fournie dans ce dépôt. L’application client et ses médias restent sur **app.cashpay-all.com**. Backend **JavaScript / Node.js**, sans PHP ni nouveau framework de présentation.

## Livraison actuelle

- Connexion des comptes `Admin` et `AccountManager` actifs : ID Wallet ou e-mail → OTP envoyé par e-mail → PIN Cashpay existant. Aucun compte ou code de démonstration créé.
- Inscription Client en quatre étapes : identité, coordonnées, photo/signature/pièce et confirmation, avec PIN généré, notifications et certificat A4 historisé. Voir [le contrat et les droits SQL](docs/account-creation.md).
- Tableau de bord global : utilisateurs, comptes actifs, pays représentés, pays avec au moins un compte actif, titulaires avec et sans dépôt confirmé, somme exacte des soldes USD et EUR, toutes les devises de soldes non nuls, répartition par pays.
- Configuration Admin des frais et taux de change : recherche, ajout, modification, pays et codes ISO, paliers fixes/pourcentages, PIN et historique. Voir [le contrat de tarification](docs/pricing.md).
- Centralisation financière : frais bruts par devise, registres crypto BTC/USDT, commissions, comptes de flotte/revenus, activités et corridors internationaux. Voir [sources et limites](docs/finance-dashboard.md).
- Graphiques Chart.js de la template : répartition des déposants, inscriptions/premiers dépôts sur douze mois, volumes du registre dans une seule devise sélectionnée.
- Espace Gestionnaire de compte sans soldes ni rapports financiers, limité aux Clients du pays/province attribués, avec commande physique à débit consenti. Voir [droits et migration enum](docs/account-manager.md).
- Mise à jour de clients et activation Partenaire B2B, protégées par PIN Admin et journalisées. Menus dédiés aux transactions, commandes de cartes, ventes/articles/vendeurs et historique.
- Recherche par nom, téléphone, e-mail ou ID Wallet. Fiche utilisateur : avatar public, identité de consultation, soldes par devise, dépôts et listes paginées des transactions, demandes de cartes et commandes.
- Filtre pays, actualisation manuelle et toutes les 10 secondes lorsque le tableau de bord est visible. Les données affichées portent leur heure de lecture. Une panne n’est pas remplacée par des chiffres inventés.

Les fonctionnalités de nomination, blocage de comptes ou de pays, interruption des inscriptions, approbations/rejets et configuration globale constituent les phases suivantes. Aucun bouton ne prétend effectuer ces opérations dans ce premier lot. La restriction d’inscription devra être appliquée dans **Cashpay Web**, à l’endroit où l’inscription est réellement exécutée : un interrupteur isolé dans l’admin ne suffirait pas.

## Template conservée

Le serveur utilise `src/assets/css/style.css`, Bootstrap, les icônes MDI/Font Awesome et Chart.js **déjà livrés par la template**. Les cartes, tableaux, menu latéral, navigation mobile et formulaire de connexion reprennent ses composants et classes. Aucun logo, image ou pack d’icônes n’est généré. Les fichiers de démonstration d’origine restent comme référence dans `src`/`dist`, mais leurs pages et leur `dashboard.js` de démonstration **ne sont pas servis ni chargés par l’application**. Les pages actives sont `src/backoffice/index.html` et `login.html`. Des ajustements CSS limités gèrent le menu responsive et l’impression du certificat A4 ; les composants et icônes de la template restent utilisés.

## Environnement et lancement

Node.js **22.9 minimum** et PostgreSQL de l’application existante.

1. Installer les dépendances avec `npm ci --ignore-scripts`.
2. Utiliser `.env.example` pour configurer un environnement local/VPS privé. Ne pas publier `.env`.
3. Renseigner `ADMIN_PUBLIC_ORIGIN=https://admin.cashpay-all.com`, un **nouveau** `ADMIN_SESSION_SECRET` aléatoire d’au moins 32 caractères, puis les variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` et `DB_SCHEMA` de la même base que Cashpay Web. Ne pas recopier le secret JWT de l’application client.
4. Garder `CASH_PAY_PUBLIC_ORIGIN=https://app.cashpay-all.com` pour les URL publiques d’avatars. PostgreSQL distant : activer `DB_SSL=true` et fournir sa CA si nécessaire ; la vérification de certificat n’est jamais désactivée.
5. Exécuter `npm run check`, puis `npm start`. En production, l’origine HTTPS et les paramètres requis sont contrôlés au démarrage. Aucun secret manquant n’est remplacé par une valeur de démonstration.

Pour travailler uniquement sur la machine locale, choisir `NODE_ENV=development` et une origine exacte telle que `http://127.0.0.1:8010`. Le service écoute par défaut sur le loopback ; la publication HTTPS passe par le proxy du VPS.

Aucune nouvelle colonne ou table n’est créée. Le rôle Gestionnaire nécessite l’ajout de la valeur enum `AccountManager` par le [script fourni](docs/sql/account-manager-role.sql), sans migration automatique. La création de comptes utilise les tables existantes `users`, `wallets`, `user_documents`, `b2b_partners` et `super_agent_interventions`. Aucun script n’est exécuté automatiquement sur la base. Le catalogue de pays de Cashpay Web a été repris, avec ses codes et noms, dans `server/countries.json` ; il normalise les pays déclarés sans modifier les comptes.

### Accès SQL

Les consultations gardent la lecture seule par défaut. La création de comptes nécessite les droits d’écriture limités décrits dans [le contrat de création](docs/account-creation.md). Les requêtes applicatives utilisent les tables existantes `users`, `wallets`, `transactions`, `card_requests` et `orders`. L’authentification doit pouvoir lire les champs de compte, `pin_hash` déjà configuré ; ces champs ne sont jamais renvoyés au navigateur. `DB_SCHEMA` sélectionne le schéma existant.

Le pool impose les transactions par défaut en lecture seule ; la création de compte ouvre explicitement une transaction d’écriture. Les statistiques et fiches utilisent en plus une transaction **REPEATABLE READ READ ONLY**, avec délais de requête/verrou, pour conserver une lecture cohérente. Les services optionnels cartes/commandes manquants ou incompatibles affichent « indisponible ». Une table essentielle absente fait échouer la lecture, elle n’est pas remplacée par un total zéro. La vérification d’un schéma sur la base réelle reste nécessaire avant ouverture de l’admin.

## Règles de calcul

Voir [le contrat des indicateurs](docs/dashboard-contract.md). Les devises ne sont jamais additionnées entre elles et aucun taux fictif n’est appliqué. Les sommes PostgreSQL sont renvoyées en texte. Les montants EUR sont arrondis à deux décimales par calcul entier exact à l’affichage ; les montants en base et la précision crypto sont conservés. Les graphiques ont une précision de dessin limitée : les tableaux demeurent la référence décimale.

## Accès et sessions

L’accès global est limité au rôle `Admin` actif. Le rôle `AccountManager` dispose uniquement du périmètre de tâches décrit dans [le contrat Gestionnaire](docs/account-manager.md). Le code e-mail à six chiffres expire après dix minutes ; cinq essais incorrects invalident la demande. Le PIN existant de quatre à six chiffres est vérifié contre `users.pin_hash` (bcrypt ou ancien format numérique déjà pris en charge par Cashpay Web), sans modifier la base. Aucun accès n’est établi à la seule validation de l’OTP.

Le service utilise les mêmes variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` et les modèles e-mail Cashpay Web. Une erreur SMTP bloque l’envoi, sans afficher un faux succès. Les codes sont conservés sous empreinte en mémoire et perdus au redémarrage. Les envois et vérifications sont limités.

La session indépendante utilise un cookie HttpOnly/Secure/SameSite Strict, expire après huit heures ou soixante minutes d’inactivité, et vérifie le rôle et le statut à chaque requête. Les identifiants de session et échéances sont persistés dans `.runtime/sessions.json`, fichier privé signé ; ni OTP, ni PIN, ni jeton n’y sont stockés. Conserver `ADMIN_SESSION_SECRET` et ce répertoire entre déploiements. La déconnexion révoque la session. Une seule instance PM2 est prévue. Les anciennes sessions par mot de passe demandent une nouvelle connexion après mise à jour. Origine des mutations et CSRF de déconnexion sont contrôlés.

Pour une installation existante, voir [la mise à jour OTP/PIN](docs/login-otp-pin.md).
Seuls les actifs de la template et les scripts applicatifs explicitement autorisés sont exposés. Aucun dossier racine de dépôt, `.env`, `dist`, `.ssh` ni fichier serveur n’est accessible via le serveur HTTP. Les avatars viennent exclusivement de l’origine publique configurée ; une image privée/inaccessible conserve un état sans faux avatar.

## VPS

Le port demandé est **8010**, sur le loopback. Le [guide VPS 8010](docs/vps-8010.md) détaille le chemin demandé et l’initialisation privée du fichier admin avec `deploy/configure-env.js`. Cet outil refuse d’écraser un environnement existant.

Voir [le guide de livraison](docs/deployment.md), le modèle PM2 et le modèle Nginx sous `deploy/`. Ils ne constituent pas un déploiement effectué : DNS, certificat, variables privées, droits SQL et vérification des comptes doivent être préparés par l’exploitant. Aucune modification de production ni fusion sur `main` n’est effectuée pendant cette livraison.

## Vérifications

`npm run check` vérifie la syntaxe de tous les fichiers JavaScript applicatifs et les pages actives. Les essais SQL/API/navigateur de livraison sont exécutés sur une base temporaire **hors du dépôt**. Aucun utilisateur, mot de passe, clé, fixture ou scénario de test n’est livré dans le code de production. Le détail et les limites sont consignés dans le rapport de livraison.

## Fichiers SSH présents dans l’import initial

L’import initial suivait `.ssh/github_admin` et `.ssh/github_admin.pub` malgré l’exclusion `.ssh/`. Ils ont été retirés de l’index sans lecture de leur contenu ni suppression de la copie locale. Ils ne sont pas servis. Les anciens commits peuvent encore les contenir : le propriétaire doit vérifier s’il s’agit d’une clé active, la révoquer/remplacer si nécessaire, puis décider du traitement de l’historique. Cette livraison ne prétend pas effacer l’historique ni révoquer une clé externe.
