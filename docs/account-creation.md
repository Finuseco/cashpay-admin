# Inscription, médias, certificat et gestion des clients

## Parcours livré

Le menu « Nouvelle inscription » guide un Admin actif en quatre étapes : identité, coordonnées/compte, photo/signature/pièce, puis confirmation. Il propose des comptes particuliers nationaux ou diaspora. Le passage en compte partenaire est une opération séparée depuis la fiche client.

L’identité reprend nom, prénom, postnom, naissance, nationalité, profession et les champs facultatifs du schéma Cashpay. Les coordonnées comprennent e-mail du titulaire, téléphone international, pays, province, ville et adresse. Le titulaire doit confirmer ses informations avec l’administrateur. La photo, la signature et le recto de pièce sont obligatoires ; le verso et les dates de pièce sont facultatifs. Numéro de pièce unique, dates cohérentes, fichiers et coordonnées sont validés côté serveur. Les prises de vue utilisent la caméra native du navigateur ; il ne s’agit pas d’une reconnaissance faciale ou d’un OCR automatique.

Le serveur génère le PIN initial à quatre chiffres avec `crypto.randomInt` et conserve seulement son empreinte bcrypt. L’interface ne demande ni n’affiche ce PIN. Les anciens appels administratifs peuvent encore fournir un PIN confirmé ; le nouveau formulaire utilise toujours la génération serveur.

La création transactionnelle écrit le Client actif, son portefeuille à zéro (USD/EUR/devise locale), sa ligne `user_documents` et l’intervention `ACCOUNT_CREATE`. Une erreur annule ces écritures. Aucun statut KYC ni passeport auto-vérifié n’est attribué. Le verrou et les contraintes de doublon du schéma sont conservés.

## Photos et documents

`POST /api/registration/media` exige Admin, origine et CSRF. Les fichiers sont limités à 5 Mo : JPEG/PNG, et PDF pour les pièces. Sharp décode les images, corrige leur orientation, retire les métadonnées et réencode en JPEG. Les images trop grandes ou trompeuses sont rejetées. La signature peut être dessinée ou importée ; la caméra et l’import de fichier sont proposés.

Les fichiers privés et leurs métadonnées sont conservés sous `ADMIN_STATE_DIR/registration-media`, avec répertoire privé et fichiers 0600. Les identifiants sont aléatoires, l’auteur est contrôlé et les fichiers doivent être rattachés à une inscription dans les 24 heures. Aucune suppression automatique des pièces n’est exécutée. Sauvegarder ce dossier avec la base et gérer sa rétention selon les règles de l’exploitation.

Les avatars destinés à être publics sont également écrits dans `CASH_PAY_AVATAR_DIR`, le dossier `public/images/avatars` de Cashpay Web. Leur URL publique reste celle du Wallet, compatible avec son mécanisme actuel de téléchargement d’images après build. Aucun fichier existant n’est écrasé. Conserver et sauvegarder aussi ces avatars pour permettre les réimpressions des certificats. En production, l’inscription exige cette configuration explicite pour éviter des avatars indisponibles dans le client. Le service de consultation local `/media/avatars/:id` ne sert jamais une pièce ou signature.

Les pièces et signatures sont accessibles via `/api/registration/media/:id`, après authentification Admin. Leur URL est enregistrée dans les colonnes existantes. Les autres applications et les agents utilisant uniquement la session client n’héritent pas de cet accès : leur éventuelle consultation des nouvelles pièces nécessite un contrat de lecture authentifié supplémentaire. Cette livraison ne publie pas ces pièces dans le dossier public du Wallet.

## Messages de bienvenue

Après le commit, le compte reçoit ID Wallet et PIN par e-mail avec les modèles Cashpay Web `_base.html`/`welcome.html` et les paramètres SMTP existants. Dream Digital SMS utilise les paramètres existants `DREAM_DIGITAL_*`. WhatsApp utilise `WHATSAPP_PHONE_NUMBER_ID` et `WHATSAPP_ACCESS_TOKEN` si configurés ; les contraintes de fenêtre de conversation ou de modèle Meta peuvent entraîner un refus explicite.

Les canaux sont exécutés en parallèle et leur résultat est enregistré dans l’intervention `ACCOUNT_WELCOME`, sans PIN. « accepted » signifie accepté par le service d’envoi, pas remis ou lu par le destinataire. Les réponses ambiguës SMS restent « unconfirmed ». Un canal absent est « not_configured », un refus « failed ». L’écran montre les résultats réels et l’historique permet de les consulter.

Un échec d’envoi après commit n’efface pas le compte et ne simule pas un succès. Il faut utiliser la procédure Cashpay existante de récupération du PIN, sans recréer le compte. Aucun stockage durable du PIN ni mécanisme de réexpédition automatique n’est ajouté ; un arrêt du processus entre commit et notification nécessite cette récupération.

## Certificat et historique

`GET /users/:id/certificate` imprime un certificat HTML en A4, ou permet son enregistrement en PDF par le navigateur. La référence vient de l’ID Wallet et de l’intervention réelle, pas d’un hash ou cachet inventé. L’inscription conserve un instantané d’identité dans `super_agent_interventions.detail` ; une modification ultérieure du client ne réécrit pas cet instantané. La signature recueillie et la photo sont intégrées. Aucun PIN n’est imprimé. Le certificat atteste l’enregistrement, pas la validation KYC ni un solde.

L’historique `/registrations` est paginé et affiche date, client, administrateur, action et détail, dont les résultats de notification. Il concerne les inscriptions/interventions tracées dans ce back-office. Les anciennes inscriptions sans instantané affichent clairement une réédition selon les données actuelles. Aucun historique d’une autre application n’est fabriqué.

## Mise à jour et passage en partenaire

Depuis la fiche, un Admin peut corriger les noms, coordonnées, province, ville, adresse, nationalité et profession d’un Client ou Partenaire B2B. L’enregistrement exige son PIN, un motif et une version de fiche ; cinq PIN incorrects bloquent ces mutations pendant quinze minutes. Une modification concurrente est refusée. Les valeurs avant/après sont journalisées. Les rôles, soldes et secrets ne sont pas modifiables dans ce formulaire.

L’activation partenaire exige un Client actif, un nom d’entreprise, la confirmation et le PIN Admin. Elle reprend le contrat existant : rôle `PartnerB2B`, type `business`, clés API live/test dans `users`, enregistrement de `b2b_partners` et intervention `ROLE_UPGRADE_B2B`. Les clés et secrets ne sont jamais retournés à ce formulaire. Aucun portefeuille n’est débité, crédité ou automatiquement financé ; l’utilisation des services partenaires conserve leurs règles de liquidité et de permissions.

## Services et menus

Les entrées sont groupées : pilotage/transactions/trésorerie, comptes/inscription/historique, cartes/commerce. Le menu Corona conserve ses composants ; des ajustements de défilement, de largeur et d’accessibilité couvrent mobile et desktop.

`GET /api/operations/:kind` fournit les listes réelles paginées de transactions, cartes, commandes et interventions, avec recherche et statut. Le détail d’une commande relie acheteur, articles, quantités et vendeurs. Ces listes ne prétendent pas approuver une carte, rembourser ou régler une vente : ces actes restent dans les moteurs de services dédiés et ne sont pas simulés ici.

## Schéma et droits

Aucune colonne ni table inventée ou migration automatique. La livraison utilise les colonnes d’inscription existantes de `users`, `wallets`, `user_documents`, `super_agent_interventions` et, pour les partenaires, `b2b_partners`. Le rôle enum doit déjà contenir `PartnerB2B`, comme le code Cashpay Web. Le champ `detail` du journal doit accepter les instantanés JSON en texte.

Le compte SQL nécessite SELECT sur les sources, INSERT sur les tables d’inscription/journal, UPDATE sur les champs gérés de `users` et de `b2b_partners`, et USAGE sur leurs séquences. Les consultations restent en lecture seule par défaut ; seules les mutations ouvrent une transaction `READ WRITE`.

## Mise à jour du VPS existant

```bash
bash -eu <<'UPDATE'
cd /var/www/caspay-all/admin
git pull --ff-only origin codex/admin-dashboard
npm ci --ignore-scripts
npm run check
node deploy/configure-registration-storage.js /var/www/cashpay-all/wallet/public/images/avatars
pm2 restart cashpay-admin --update-env
node deploy/configure-registration-proxy.js /etc/nginx/sites-enabled/cashpay-all-admin.conf
curl --retry 5 --retry-connrefused --retry-delay 2 --max-time 5 http://127.0.0.1:8010/healthz
UPDATE
```

L’outil de stockage ajoute seulement le chemin d’avatars, avec sauvegarde privée de `.env`, sans modifier les autres paramètres. Le second identifie uniquement le bloc Nginx `admin.cashpay-all.com` qui cible 8010, augmente la limite de corps à 8 Mo et l’attente à 90 secondes, sauvegarde dans `.runtime/nginx-backups`, valide avec `nginx -t`, recharge gracieusement et restaure le contenu initial en cas d’échec. Les autres blocs restent identiques. Aucun processus client n’est redémarré et aucun build Next.js n’est nécessaire.

## Vérification de livraison

SQL PGlite isolé et Chromium : fichiers et contrôles d’accès, contenu trompeur refusé, PIN généré, contrat de bienvenue, doublons, rollback, version et PIN Admin, activation partenaire, quatre étapes, certificat PDF A4 d’une page sur le cas vérifié, listes des services et détail vendeurs, menu mobile/desktop. Les notifications utilisent des transports de test hors Git ; aucun message ni compte de production n’est créé. Les réponses positives, ambiguës et négatives SMS sont vérifiées séparément. La réception réelle SMTP/SMS/WhatsApp et les permissions SQL/fichiers/Nginx restent à vérifier après déploiement.
