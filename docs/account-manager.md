# Gestionnaire de compte : rôle et assistance en agence

Le portail reconnaît deux profils professionnels : `Admin` et `AccountManager` (libellé « Gestionnaire de compte »). Ils utilisent le même parcours ID Wallet/e-mail → OTP e-mail → PIN. Le rôle et le statut sont relus en base à chaque requête ; ils ne sont pas accordés par un paramètre du navigateur ni conservés comme autorisation immuable dans le JWT.

| Fonction | Admin | Gestionnaire |
|---|---|---|
| Tableau de bord financier, soldes, frais, revenus, transactions globales | Oui | Refusé côté serveur |
| Recherche et fiche d’identité client | Tous les comptes | Clients du périmètre attribué |
| Inscription avec photos, pièce, signature et certificat | Oui | Dans son périmètre |
| Mise à jour des informations client | PIN professionnel, motif, version | Mêmes contrôles et périmètre |
| Changement d’e-mail ou téléphone du client | PIN Admin | PIN professionnel et PIN du titulaire |
| Nomination/révocation des gestionnaires | PIN Admin | Refusé |
| Activation Partenaire B2B | PIN Admin | Refusé |
| Commande physique Visa/Mastercard USD/EUR | Tarif + deux PIN + consentement | Mêmes contrôles et périmètre |
| Historique d’intervention | Global | Ses interventions concernant les Clients du périmètre |
| Commandes commerciales et vendeurs globaux | Consultation | Refusé |

Les réponses JSON destinées au Gestionnaire ne contiennent pas `balances`, `deposits`, `walletQuality`, montants disponibles, transactions ou commissions des clients. Les menus correspondants sont masqués et les API refusent l’accès même par requête manuelle. Le tarif d’une carte est affiché pour recueillir le consentement : ce prix n’est pas un solde.

## Nomination

Exécuter d’abord dans Adminer le fichier [sql/account-manager-role.sql](sql/account-manager-role.sql), sur le schéma Cashpay utilisé. Il ajoute uniquement la valeur `AccountManager` au type enum réel de `users.role`, découvert dans les catalogues PostgreSQL ; aucun nom de type n’est deviné et aucun utilisateur n’est élevé automatiquement. Exécuter le script séparément de la nomination et laisser la transaction se terminer. Si la colonne est textuelle, le script ne modifie pas ses contraintes CHECK ; celles-ci doivent être vérifiées par l’exploitant.

Depuis une fiche Client active, l’Admin ouvre « Habilitations Gestionnaire », sélectionne le rôle, le pays et éventuellement la province puis saisit son PIN. Un compte professionnel est préparé en inscrivant d’abord la personne comme Client. Les Admins, partenaires et autres rôles ne sont pas convertis par cet écran ; aucune modification de son propre rôle n’est permise. La révocation sélectionne `Client`. La nomination utilise les champs existants `users.country` et `users.province` comme périmètre opérationnel ; elle journalise `ACCOUNT_MANAGER_ASSIGN`. Elle ne crée ni agence, ni table d’agence, ni banque fictive.

Une province renseignée restreint les clients à cette province du pays. Sans province, le périmètre couvre le pays. Sans pays valide, aucun accès clientèle du Gestionnaire n’est accordé. Les noms/codes pays sont rapprochés du catalogue Cashpay, les provinces comparées après normalisation des espaces de bord et de la casse. Le Gestionnaire ne peut pas élargir son propre périmètre, modifier un autre membre du personnel, ni déplacer un client hors du périmètre attribué.

Après connexion, son espace de tâches s’ouvre sur la recherche client, avec inscription, mise à jour, demandes de cartes et historique. Les pièces privées restent soumises à la même portée géographique ; un identifiant de fichier ne suffit pas à lire un document hors périmètre. Une révocation retire l’accès aux requêtes suivantes de la session existante.

## Commande physique et consentement

1. `POST /api/users/:id/card-quote` valide le périmètre et le produit, puis lit le tarif réel dans `fee_structures` : `BUY_CARDS_USD_P_FEE` ou `BUY_CARDS_EUR_P_FEE`, pays `GBL`, comme le parcours délégué Cashpay Web. Il utilise le palier applicable à la base 1, conformément à ce parcours. Un tarif absent/ambigu/invalide bloque l’opération ; aucun tarif gratuit de remplacement.
2. Le devis signé lie opérateur, titulaire, produit et prix pendant dix minutes. L’écran montre le prix exact, même si un tarif contient plus de deux décimales. Aucune balance n’est retournée.
3. `POST /api/users/:id/card-orders` exige le consentement explicite, le PIN de l’opérateur et le PIN du titulaire, que le client doit saisir lui-même après avoir vérifié le tarif. Les tentatives erronées sont limitées. Les contacts sensibles ne peuvent pas être modifiés par le Gestionnaire pour contourner ce consentement : leur correction exige également le PIN du titulaire.
4. La transaction vérifie à nouveau le rôle/périmètre, le tarif, l’état du titulaire et les fonds sous verrou. Elle crée la demande `pending`, débite exactement le tarif dans la devise choisie, écrit la transaction `BUY_CARDS_*_P_FEE` et l’audit `CARD_ORDER`. Comme le moteur existant, le prix de service est le montant principal de cette écriture, avec `fee=0`. Un échec annule ces opérations ensemble. Une insuffisance de fonds ne révèle jamais le montant disponible.
5. L’identifiant du devis est enregistré dans `transactions.metadata`. Sa réutilisation est refusée, y compris après redémarrage ; un changement de tarif demande un nouveau consentement. La référence reprend le format Cashpay existant. Aucun PIN n’est stocké dans le journal, la transaction, le devis ou la réponse.
6. Après commit, le reçu de commande est envoyé au titulaire par les services e-mail/SMS/WhatsApp configurés, sans aucun PIN ni solde, puis le résultat est journalisé (`CARD_ORDER_NOTIFICATION`). Une acceptation du service ne constitue pas une preuve de remise. Un échec de notification ne recrée pas la commande et ne réexécute pas le débit.

L’insuffisance de fonds, le refus de consentement, un PIN erroné, un devis expiré ou un tarif modifié ne débitent pas le client. Après interruption réseau, vérifier les demandes avant d’obtenir un nouveau devis : un nouveau devis représente une nouvelle autorisation, distincte du mécanisme de protection contre la réutilisation d’un même devis.

## Attribution et livraison

Cette version enregistre des commandes physiques en attente, pas des cartes activées. Le parcours existant `src/lib/actions/super-agent/logistics.actions.ts` bloque déjà `assignAndDeliverCard` : la propriété d’une carte physique FYATU doit être confirmée par le fournisseur. La présente livraison ne contourne pas ce blocage par une insertion locale, un numéro inventé ou un changement de statut non justifié. L’attribution/livraison et l’émission virtuelle déléguée ne sont pas connectées dans cette phase. Les annulations/remboursements restent dans le moteur existant, auquel le `card_request_id` de la transaction permet le rapprochement.

## Installation et droits

Après la migration enum et la mise à jour du clone : `npm ci --ignore-scripts`, `npm run check`, puis `pm2 restart cashpay-admin --update-env`. Les configurations médias/proxy de l’inscription restent celles de [account-creation.md](account-creation.md). Aucune variable secrète ni table supplémentaire.

Le compte PostgreSQL doit avoir les droits existants de lecture et ceux de gestion des comptes, plus INSERT sur `card_requests`/`transactions`/journal, UPDATE sur `wallets.balances` et USAGE sur leurs séquences. Les consultations restent en lecture seule. Les opérations de gestion ouvrent explicitement leurs transactions d’écriture. Le Gestionnaire n’a aucun accès SQL direct : ces droits appartiennent au service et ne constituent pas ses permissions applicatives.

## Vérifications

PGlite isolé et Chromium : migration enum répétable, nomination Admin, connexion Gestionnaire, redirection et menus, absence de balances dans API/DOM, portée pays/province/documents, création et correction de clients, consentement sur contacts sensibles et cartes, prix et débit décimaux, rejeu, changement de tarif, solde insuffisant sans divulgation, refus de la carte virtuelle et révocation immédiate. Régression du parcours Admin avec inscription, certificat A4, modification, partenariat et services. Aucun compte de production, débit réel ou appel de fournisseur de cartes n’a été exécuté ; les transports de notification des tests restent hors Git.
