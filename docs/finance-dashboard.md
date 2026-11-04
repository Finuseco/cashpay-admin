# Centralisation financière du dashboard

`GET /api/dashboard` inclut désormais `finance`, dans le même instantané SQL en lecture seule. L’interface utilise les cartes, tableaux, icônes et Chart.js de la template. Elle relit le dashboard toutes les dix secondes lorsqu’il est visible ; il ne s’agit pas d’un flux WebSocket ni d’une cotation de marché en continu.

## Sources réelles et calculs

- `transactions` : décompte, somme des montants et frais, regroupés par devise, type et statut ; les dépôts, retraits et transferts restent identifiés par leurs codes réels. Les cinquante écritures les plus récentes sont affichées.
- Frais bruts : somme de `transactions.fee` pour `Completed` uniquement, avec cumul, mois courant et graphique sur douze mois. Les frais des opérations Pending, Failed et Reversed restent visibles dans la ventilation par statut mais ne sont pas reconnus comme frais terminés. Les frais NULL rendent le total concerné incomplet. Aucun bénéfice net, revenu fournisseur, intérêt ou commission absent du registre n’est inventé.
- `wallets.balances` : les sommes de portefeuille existantes du dashboard sont conservées. Elles ne sont pas additionnées aux soldes crypto ou aux commissions.
- `user_crypto_balances` : somme par `currency_code`, dont BTC, USDT_TRC20 et les autres codes présents. Les réseaux ne sont pas regroupés arbitrairement. Cette table reste un registre interne, pas une vérification du solde de conservation sur la blockchain.
- `wallets.commission_balance` : somme distincte des soldes de commission par devise. Ce solde disponible n’est pas assimilé aux revenus historiques ni ajouté aux frais de transaction.
- `revenue_wallets.wallet_id` et `b2b_partners.float_wallet_id` : références vers `wallets.id_wallet`. Les portefeuilles sont dédupliqués avant totalisation, même si plusieurs références pointent vers le même compte. Les rattachements et leurs statuts sont affichés ; le total couvre tous les portefeuilles référencés trouvés, y compris ceux de rattachements inactifs. Un compte absent ou un solde mal formé produit un avertissement. Une source optionnelle absente apparaît indisponible et les totaux de trésorerie sont signalés incomplets.
- `exchange_rates` : équivalents indicatifs des frais en USD et EUR, calculés par PostgreSQL avec les taux directs configurés pour le pays sélectionné, puis GBL. Sans pays sélectionné, seuls les taux GBL sont utilisés. L’identité d’une devise vers elle-même vaut 1. Aucun taux inverse, de marché ou intermédiaire n’est inventé. Aucun équivalent absent n’est remplacé par zéro. Les devises sources restent visibles séparément, sans total global trompeur.

Les décimaux sont calculés en PostgreSQL et transmis en texte. Les tableaux préservent la précision ; les graphiques restent des représentations approximatives en nombre JavaScript. Les valeurs invalides ne sont pas présentées comme des soldes complets.

## Pays et transferts internationaux

Le filtre financier sélectionne chaque écriture une fois lorsque l’émetteur ou le bénéficiaire est rattaché au pays demandé. Il utilise les pays déclarés actuels, normalisés selon Cashpay Web, pas la géolocalisation ni le pays historique au moment de la transaction. Le tableau des corridors contient les opérations terminées ayant deux pays connus et distincts. Les opérations externes sans bénéficiaire interne restent dans les activités et les cinquante dernières écritures ; aucun pays destinataire n’est déduit. Les portefeuilles de revenus GBL restent inclus dans la trésorerie avec un filtre pays.

## Limites de connexion

Le back-office n’utilise pas la route historique `/api/finance/treasury` du client : son code contient des montants de démonstration. Cette livraison ne la modifie pas et ne reprend aucun de ces chiffres. Elle n’appelle aucun service bancaire, Stripe, PayPal, Bitcoin Core ou TRON : leurs liquidités externes restent à connecter et vérifier au moyen de contrats de consultation authentifiés. Aucune clé privée crypto n’est importée dans le back-office. Une disponibilité interne n’est jamais annoncée comme une liquidité bancaire ou blockchain vérifiée.

Aucune migration SQL ni table ajoutée. Les sources optionnelles manquantes ne bloquent pas les sources disponibles. Les permissions SQL de consultation doivent couvrir les tables ci-dessus. Les agrégats sur l’historique sont à mesurer sur le volume réel avant augmentation de la cadence ou du nombre d’opérateurs.

## Validation

Essais SQL isolés sur PGlite : précision décimale, BTC et USDT, frais terminés, exclusion Pending/Failed/Reversed des revenus, statuts, filtre pays, corridors, taux pays/GBL, taux absent, double référence de flotte, portefeuille absent, JSON null/invalide, tables optionnelles absentes. Parcours Chromium : dashboard, tableau de frais, crypto, comptes référencés et graphique de frais ; régression connexion OTP/PIN, recherche utilisateur et création de compte. Aucun fournisseur, compte ni base de production utilisé pendant les essais.
