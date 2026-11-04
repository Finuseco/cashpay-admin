# Création d’un compte Client depuis le back-office

Depuis le menu « Créer un compte », un Admin actif renseigne l’identité, l’e-mail, le téléphone international, le pays de résidence, la province éventuelle, la ville, l’adresse, la naissance et la nationalité. Comptes particuliers nationaux et diaspora uniquement. Le titulaire choisit son PIN initial à quatre chiffres, confirmé une seconde fois. Le formulaire demande de confirmer son accord. Aucun PIN n’est retourné ni journalisé ; il est enregistré avec bcrypt. Aucun e-mail de bienvenue n’est annoncé ou envoyé par cette fonction.

`GET /api/registration/countries` retourne le catalogue de pays et devises repris de Cashpay Web. `POST /api/users` exige la session Admin, l’origine autorisée, le jeton CSRF et limite les tentatives. Un rôle ou un solde fourni dans la requête est refusé.

Le compte est créé avec le rôle `Client`, statut `Active`, comme l’inscription Cashpay Web existante. Le portefeuille utilise le format pays + `01` + huit chiffres et des soldes USD, EUR et devise locale à zéro. La vérification KYC n’est pas accordée automatiquement ; aucun document fictif ni ligne de pièce vide n’est créé. La collecte des pièces et les comptes Business ne sont pas livrés dans ce formulaire.

Les écritures sont dans une transaction explicite `READ WRITE`. Le pool garde son défaut lecture seule pour les autres parcours. Le rôle Admin est revérifié dans la transaction. L’intervention est enregistrée dans la table existante `super_agent_interventions`, avec l’administrateur, le compte cible et le type `ACCOUNT_CREATE`. Un échec du journal, du compte ou du portefeuille annule toute la transaction. Les créations admin sont sérialisées ; les contraintes uniques existantes protègent également les écritures concurrentes provenant du client Web. Un conflit d’identifiant est signalé sans réessai automatique. Après une interruption réseau, rechercher d’abord le compte avant de réessayer.

## Déploiement

Aucune nouvelle table ni colonne n’est ajoutée. La base doit déjà posséder les colonnes d’inscription Cashpay et `super_agent_interventions`. Le compte PostgreSQL utilisé doit disposer de SELECT sur les tables de lecture, INSERT sur `users`, `wallets`, `super_agent_interventions`, UPDATE nécessaire au verrouillage de lignes `users`, et USAGE sur leurs séquences. Un rôle SQL strictement en lecture seule ne peut pas créer de compte : les droits doivent être accordés par l’exploitant, sans modifier les autres comptes ni fournir de permissions globales.

```bash
bash -eu <<'UPDATE'
cd /var/www/caspay-all/admin
git pull --ff-only origin codex/admin-dashboard
npm ci --ignore-scripts
npm run check
pm2 restart cashpay-admin --update-env
UPDATE
```

Les essais de livraison utilisent SQL PGlite et Chromium sur une base isolée : création complète, soldes locaux, bcrypt, trace d’audit, doublons, refus des rôles, dates et PIN invalides, annulation sur panne d’audit, protection CSRF et formulaire jusqu’à la fiche du compte. Aucun compte de production créé pendant ces essais.
