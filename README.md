# Cashpay Admin — tableau de bord de la base partagée

Back-office indépendant pour **admin.cashpay-all.com**, basé sur la template Corona fournie dans ce dépôt. L’application client et ses médias restent sur **app.cashpay-all.com**. Backend **JavaScript / Node.js**, sans PHP ni nouveau framework de présentation.

## Livraison actuelle

- Connexion avec le compte existant ayant le rôle `Admin`, statut actif, e-mail et mot de passe Cashpay. Si `totp_secret` est configuré, le code de l’application d’authentification est également exigé. Aucun compte, mot de passe ni jeu de données de démonstration n’est créé.
- Tableau de bord global : utilisateurs, comptes actifs, pays représentés, pays avec au moins un compte actif, titulaires avec et sans dépôt confirmé, somme exacte des soldes USD et EUR, toutes les devises de soldes non nuls, répartition par pays.
- Graphiques Chart.js de la template : répartition des déposants, inscriptions/premiers dépôts sur douze mois, volumes du registre dans une seule devise sélectionnée.
- Recherche par nom, téléphone, e-mail ou ID Wallet. Fiche utilisateur : avatar public, identité de consultation, soldes par devise, dépôts et listes paginées des transactions, demandes de cartes et commandes.
- Filtre pays, actualisation manuelle et toutes les 60 secondes lorsque le tableau de bord est visible. Les données affichées portent leur heure de lecture. Une panne n’est pas remplacée par des chiffres inventés.

Les fonctionnalités de nomination, blocage de comptes ou de pays, interruption des inscriptions, approbations/rejets et configuration globale constituent les phases suivantes. Aucun bouton ne prétend effectuer ces opérations dans ce premier lot. La restriction d’inscription devra être appliquée dans **Cashpay Web**, à l’endroit où l’inscription est réellement exécutée : un interrupteur isolé dans l’admin ne suffirait pas.

## Template conservée

Le serveur utilise `src/assets/css/style.css`, Bootstrap, les icônes MDI/Font Awesome et Chart.js **déjà livrés par la template**. Les cartes, tableaux, menu latéral, navigation mobile et formulaire de connexion reprennent ses composants et classes. Aucun logo, image ou pack d’icônes n’est généré. Les fichiers de démonstration d’origine restent comme référence dans `src`/`dist`, mais leurs pages et leur `dashboard.js` de démonstration **ne sont pas servis ni chargés par l’application**. Les pages actives sont `src/backoffice/index.html` et `login.html`. Aucun CSS supplémentaire.

## Environnement et lancement

Node.js **22.9 minimum** et PostgreSQL de l’application existante.

1. Installer les dépendances avec `npm ci --ignore-scripts`.
2. Utiliser `.env.example` pour configurer un environnement local/VPS privé. Ne pas publier `.env`.
3. Renseigner `ADMIN_PUBLIC_ORIGIN=https://admin.cashpay-all.com`, un **nouveau** `ADMIN_SESSION_SECRET` aléatoire d’au moins 32 caractères, puis les variables `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` et `DB_SCHEMA` de la même base que Cashpay Web. Ne pas recopier le secret JWT de l’application client.
4. Garder `CASH_PAY_PUBLIC_ORIGIN=https://app.cashpay-all.com` pour les URL publiques d’avatars. PostgreSQL distant : activer `DB_SSL=true` et fournir sa CA si nécessaire ; la vérification de certificat n’est jamais désactivée.
5. Exécuter `npm run check`, puis `npm start`. En production, l’origine HTTPS et les paramètres requis sont contrôlés au démarrage. Aucun secret manquant n’est remplacé par une valeur de démonstration.

Pour travailler uniquement sur la machine locale, choisir `NODE_ENV=development` et une origine exacte telle que `http://127.0.0.1:3102`. Le service écoute par défaut sur le loopback ; la publication HTTPS passe par le proxy du VPS.

Aucune migration, colonne ou table supplémentaire n’est nécessaire pour cette phase. Aucun script n’est exécuté automatiquement sur la base. Le catalogue de pays de Cashpay Web a été repris, avec ses codes et noms, dans `server/countries.json` ; il normalise les pays déclarés sans modifier les comptes.

### Accès SQL

Un utilisateur PostgreSQL de lecture dédié est recommandé. Les requêtes applicatives utilisent les tables existantes `users`, `wallets`, `transactions`, `card_requests` et `orders`. L’authentification doit pouvoir lire les champs de compte, `password_hash` et le secret TOTP déjà configuré ; ces champs ne sont jamais renvoyés au navigateur. `DB_SCHEMA` sélectionne le schéma existant.

Le pool impose les transactions par défaut en lecture seule. Les statistiques et fiches utilisent en plus une transaction **REPEATABLE READ READ ONLY**, avec délais de requête/verrou, pour conserver une lecture cohérente. Les services optionnels cartes/commandes manquants ou incompatibles affichent « indisponible ». Une table essentielle absente fait échouer la lecture, elle n’est pas remplacée par un total zéro. La vérification d’un schéma sur la base réelle reste nécessaire avant ouverture de l’admin.

## Règles de calcul

Voir [le contrat des indicateurs](docs/dashboard-contract.md). Les devises ne sont jamais additionnées entre elles et aucun taux fictif n’est appliqué. Les sommes PostgreSQL sont renvoyées en texte et affichées sans conversion en flottant JavaScript. Les graphiques ont une précision de dessin limitée : les tableaux demeurent la référence décimale.

## Accès et sessions

L’accès **global** est limité au rôle `Admin` actif. Les super-agents régionaux ne reçoivent pas un accès global implicite. L’authentification réutilise les empreintes bcrypt déjà présentes dans la base. Un compte sans mot de passe doit être configuré par la procédure existante ; aucune procédure de récupération ou nomination administrateur n’est ajoutée ici.

La session indépendante expire après 30 minutes, utilise un cookie HttpOnly/Secure/SameSite Strict, et est revérifiée contre le rôle/statut actuel à chaque requête. Les sessions sont gardées en mémoire, révoquées à la déconnexion et perdues au redémarrage. **Une seule instance PM2**, comme configuré dans `deploy/ecosystem.config.cjs`, est prévue ; plusieurs instances exigeraient un stockage de session et de limitation de tentatives partagé. Les mots de passe, PIN, secrets et jetons ne sont pas journalisés. Origine des mutations vérifiée et jeton anti-CSRF pour la déconnexion. Tentatives limitées côté application et dans le modèle Nginx.

Seuls les actifs de la template et les scripts applicatifs explicitement autorisés sont exposés. Aucun dossier racine de dépôt, `.env`, `dist`, `.ssh` ni fichier serveur n’est accessible via le serveur HTTP. Les avatars viennent exclusivement de l’origine publique configurée ; une image privée/inaccessible conserve un état sans faux avatar.

## VPS

Voir [le guide de livraison](docs/deployment.md), le modèle PM2 et le modèle Nginx sous `deploy/`. Ils ne constituent pas un déploiement effectué : DNS, certificat, variables privées, droits SQL et vérification des comptes doivent être préparés par l’exploitant. Aucune modification de production ni fusion sur `main` n’est effectuée pendant cette livraison.

## Vérifications

`npm run check` vérifie la syntaxe de tous les fichiers JavaScript applicatifs et les pages actives. Les essais SQL/API/navigateur de livraison sont exécutés sur une base temporaire **hors du dépôt**. Aucun utilisateur, mot de passe, clé, fixture ou scénario de test n’est livré dans le code de production. Le détail et les limites sont consignés dans le rapport de livraison.

## Fichiers SSH présents dans l’import initial

L’import initial suivait `.ssh/github_admin` et `.ssh/github_admin.pub` malgré l’exclusion `.ssh/`. Ils ont été retirés de l’index sans lecture de leur contenu ni suppression de la copie locale. Ils ne sont pas servis. Les anciens commits peuvent encore les contenir : le propriétaire doit vérifier s’il s’agit d’une clé active, la révoquer/remplacer si nécessaire, puis décider du traitement de l’historique. Cette livraison ne prétend pas effacer l’historique ni révoquer une clé externe.
