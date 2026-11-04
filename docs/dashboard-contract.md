# Contrat des indicateurs — phase tableau de bord

## Périmètre

Toutes les lectures viennent des tables de Cashpay Web. La sélection pays vise le **pays déclaré du compte**, pas son IP ni l’emplacement physique d’une opération. Les noms/codes connus sont normalisés à partir du catalogue existant ; une valeur non reconnue reste distincte et un pays absent est affiché « Non renseigné ».

- **Utilisateurs** : tous les enregistrements de `users`, y compris les rôles de gestion. Ce total n’est pas présenté comme un total de clients particuliers uniquement.
- **Comptes actifs** : `LOWER(status::text)='active'`.
- **Pays représentés** : pays déclarés non vides distincts après normalisation.
- **Pays actifs** : au moins un utilisateur actif dans ce pays déclaré. Cet indicateur ne signifie pas que l’inscription ou une licence commerciale y est activée.

## Titulaires ayant déposé

Une écriture doit avoir un montant strictement positif, un statut `Completed` et un type parmi :

`DP`, `DP_AGENT`, `DP_SUPER_AGENT`, `DP_CRYPTO`, `DP_CARD`, `DP_PAYPAL`.

Pour `DP_AGENT` et `DP_SUPER_AGENT`, le titulaire crédité est `receiver_id`. Pour les autres, c’est `sender_id` puis, s’il est absent, `receiver_id`. Cette distinction reprend le règlement observé dans Cashpay Web. Un utilisateur ne compte qu’une fois, même avec plusieurs dépôts. Les transferts `TR`, prêts, récompenses, mouvements en attente ou annulés et montants nuls/négatifs ne font pas de lui un déposant selon cette définition. De nouveaux types de dépôt devront être rapprochés avec le registre avant ajout à cette liste.

**Sans dépôt** signifie qu’aucune écriture de dépôt confirmée ainsi définie n’existe dans l’historique disponible. Ce n’est pas un synonyme de portefeuille vide : un utilisateur peut avoir reçu un transfert sans déposer, ou avoir dépensé l’intégralité de ses dépôts. Une suppression d’historique antérieure limite la mesure ; aucun historique n’est reconstitué fictivement.

Les douze mois d’inscriptions viennent de `users.created_at`. Les premiers déposants sont classés selon le minimum de date de dépôt de leur historique, puis comptés sur la période UTC. Les dates absentes ne sont pas inventées.

## Soldes et devises

Les soldes sont lus dans `wallets.balances`, décomposés et additionnés **par clé devise**. Les montants restent des décimaux PostgreSQL et sont envoyés sous forme de chaînes. L’interface utilise les entiers arbitraires pour formater leur partie entière. USD/EUR sont des sommes de soldes existants, sans conversion depuis CDF/BTC/USDT.

Une devise est listée si au moins un solde est non nul, ou si une valeur doit être vérifiée. Les soldes négatifs restent visibles et ne sont pas transformés en zéro. Une valeur non numérique est signalée ; sa somme n’est pas affichée comme complète. Un portefeuille au format non objet est également signalé. Un portefeuille absent n’est pas présenté comme un portefeuille attesté à zéro dans la fiche du compte.

Le graphique des dépôts utilise les **montants et devises des écritures du registre**. Il n’additionne pas des devises et ne prétend pas être le montant total de liquidités détenues. Certains dépôts par agent avec conversion ont une devise d’écriture différente de celle créditée au bénéficiaire ; c’est le solde actuel par devise qui indique ce qu’il détient. Aucun calcul de solvabilité, bénéfice, revenu net ou réconciliation fournisseur n’est déduit de ces graphiques.

## Commandes et cartes

`card_requests` représente les demandes de cartes enregistrées par l’application. Le statut est affiché tel qu’enregistré, sans supposer qu’une carte est approuvée ou fabriquée. Le type physique/virtuel et la marque ne sont affichés que s’ils figurent dans la demande. `orders` contient les commandes commerciales et leur montant dans la devise d’origine. Une table ou colonne optionnelle absente donne un état « indisponible », distinct d’une file vide.

Les activités d’une fiche concernent uniquement son identifiant. Les transactions où ce compte est émetteur ou bénéficiaire sont listées avec référence, type, montant, devise, frais, statut et date ; aucune donnée PAN, CVV, PIN, document KYC ou secret n’est projetée. Les listes sont paginées par 25.

## API

- `POST /api/auth/email` : adresse du compte Admin actif, envoi SMTP du code.
- `POST /api/auth/otp` : vérification du code, passage au PIN sans session admin.
- `POST /api/auth/pin` : PIN existant ; création de session après validation des deux étapes.
- `GET /api/auth/status`, `POST /api/auth/reset` : reprise ou abandon de la demande.
- Ancien `POST /api/login` : désactivé (HTTP 410).
- `GET /api/session`, `POST /api/logout` : session indépendante et révocation de la session courante.
- `GET /api/dashboard?country=CD` : instantané global ou pays, graphiques et disponibilité des files.
- `POST /api/users` : création d’un compte Client et de son portefeuille, journalisée ; session Admin et CSRF requis. Voir [le contrat](account-creation.md).
- `GET /api/users?search=...&page=0&country=CD` : recherche littérale paramétrée, normalisation du téléphone sur neuf chiffres comme Cashpay Web.
- `GET /api/users/{id}` : fiche, soldes et dépôts.
- `GET /api/users/{id}/activity?kind=transactions|cards|orders&page=0` : activités paginées.
- `GET /healthz` : disponibilité du processus uniquement, sans attestation de connexion à la base.

La création de comptes ajoute un Client et un portefeuille à zéro ; elle ne nomme pas d’agent. Les autres routes ne modifient aucun compte, tarif, pays ou solde. Les opérations de gestion seront des phases séparées avec leurs contrôles et journaux réels.
