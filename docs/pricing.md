# Frais et taux de change par pays

Les menus **Frais des services** et **Taux de change** utilisent les composants de la template et les tables existantes `fee_structures` et `exchange_rates`. Les règles de tarification ne nécessitent aucune nouvelle colonne. Les nouveaux avis e-mail exigent cependant les deux tables du [script communications](sql/admin-communications.sql), à exécuter dans Adminer avant cette mise à jour. Le rôle `AccountManager` n’a accès ni aux écrans ni aux API de tarification.

## Frais

La liste permet de rechercher un code de service, filtrer par pays, devise et état, modifier ou dupliquer une règle. La sélection du pays attribue son code ISO ; GBL désigne le niveau global. Les devises et codes de service existants sont proposés, et un nouveau code peut être saisi. Un nouveau code n’est facturé que lorsqu’un service métier utilise effectivement ce code : créer une ligne ne crée pas un nouveau service.

Chaque règle est identifiée par `transaction_type`, `currency`, `country_code`. Les paliers `fee_tiers` contiennent `min`, `max`, `fee` : montant fixe ou pourcentage (exemple `2%`). Une borne maximale de zéro est illimitée. Les bornes sont inclusives ; sur une limite commune, le premier palier est retenu, conformément au moteur client. Les intervalles inversés ou se chevauchant à l’intérieur sont refusés. L’état actif est modifiable ; aucune suppression ni modification rétroactive des transactions n’est proposée.

Les codes globaux du backend, dont les frais de cartes, restent au niveau GBL. Certains retraits mobiles USD/EUR ont un repli CD. L’aperçu indique la règle réellement trouvée ; une règle absente n’est pas remplacée par un zéro fictif. Il prévisualise le moteur de barème, et non tous les éventuels traitements spécifiques d’un service. Les notes de service expliquent notamment que MONPAYS_PAGE conserve un minimum de repli dans son parcours client : enregistrer zéro ne rend pas automatiquement ce service gratuit.

Les anciens paliers uniquement `flat` ou uniquement `percent` sont convertibles dans l’éditeur. Une combinaison des deux exige un choix explicite du nouveau tarif, sans conversion silencieuse.

## Taux de change

Une règle associe pays, devise de départ, devise d’arrivée et taux strictement positif. L’identité de la règle est conservée à la modification ; utiliser Dupliquer pour une autre paire. Le sens inverse nécessite sa propre règle. Aucun cours externe ni conversion automatique des soldes n’est inventé. Le repli GBL dépend du parcours client : certains moteurs exigent un taux du pays exact.

Une précision incompatible avec la colonne PostgreSQL entraîne un refus et un rollback, plutôt qu’un arrondi silencieux.

## Autorisation et journalisation

Chaque enregistrement exige le PIN Admin existant et une justification. Le serveur vérifie à nouveau le rôle, l’origine, la session et le jeton CSRF. Les versions empêchent d’écraser une modification concurrente. Les opérations et leur historique avant/après sont enregistrés atomiquement dans `super_agent_interventions` ; un échec de journalisation annule la modification. Les PIN ne sont pas journalisés.

Le compte SQL du back-office doit disposer des droits de lecture, insertion et mise à jour sur les deux tables, ainsi que des droits déjà nécessaires au journal et à sa séquence. Le service ne lance aucun DDL automatiquement.

## API

- `GET /api/pricing/catalog` : pays, devises, types et règles de portée.
- `GET /api/pricing/fees`, `/rates`, `/history` : recherches et pagination.
- `POST /api/pricing/fees` ou `/rates` : ajout.
- `PUT /api/pricing/fees` ou `/rates` : modification avec version.
- `POST /api/pricing/fee-preview` : aperçu sans écriture.

## Mise à jour VPS

Dans le clone admin, sans toucher aux applications voisines ni au fichier d’environnement :

```bash
cd /var/www/caspay-all/admin
git pull --ff-only origin codex/admin-dashboard
npm ci --ignore-scripts
npm run check
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
```

Les essais de livraison ont couvert SQL et navigateur sur une base temporaire : ajout/modification, paliers et pourcentages, replis pays/GBL/CD, lecture du tarif réel de carte, précision des taux, conflits de versions, doublons, PIN, CSRF, restriction Gestionnaire, affichage mobile et rollback du journal. Aucun appel fournisseur, notification réelle ou accès à la base de production pendant ces essais. Les scénarios restent hors du dépôt livré.
