# Livraison VPS — admin.cashpay-all.com

Cette procédure est préparée, non exécutée. Elle n’autorise pas une intervention sur le service client et ne nécessite aucune modification de son schéma pour la phase de consultation.

1. Valider la PR du dépôt `Finuseco/cashpay-admin` et choisir sa révision à livrer dans un répertoire dédié au back-office. Ne pas copier ce dépôt sur celui de Cashpay Web.
2. Installer Node.js 22.9+ et les dépendances verrouillées : `npm ci --ignore-scripts` puis `npm run check`.
3. Préparer hors Git `.env` ou les variables du gestionnaire de processus. L’exemple est `.env.example` ; ne jamais remplacer un fichier d’environnement de production existant. L’origine admin est `https://admin.cashpay-all.com`, celle des médias est `https://app.cashpay-all.com`. Le secret de session admin doit être indépendant.
4. Configurer un accès PostgreSQL dédié à la base/schéma existants avec les droits de lecture nécessaires sur les tables documentées. Le code ne crée ni table, ni utilisateur SQL, ni compte administrateur. Vérifier TLS selon l’accès PostgreSQL choisi.
5. Tester localement le processus et `/healthz`, puis une connexion avec un compte Admin existant. `/healthz` seul ne prouve pas que les requêtes de tableau de bord fonctionnent. Ne jamais exposer le port Node directement sur Internet.
6. Utiliser `pm2 start deploy/ecosystem.config.cjs`, une seule instance. Les sessions et limites sont en mémoire ; le redémarrage déconnecte les sessions admin. Les credentials ne doivent pas être stockés dans le fichier PM2 suivi par Git.
7. Pointer le DNS du domaine admin vers le VPS, obtenir son certificat TLS, adapter `deploy/nginx.conf.example`, valider la configuration Nginx avant de l’activer. Les chemins Let’s Encrypt du modèle sont à vérifier ; leur existence n’est pas présumée.
8. Contrôler connexion/logout, refus des rôles non Admin, compte suspendu, graphique, filtre pays, précision des soldes, recherche téléphone/Wallet et fiches d’activité sur la vraie base. Vérifier séparément les avatars publics et les états de tables optionnelles.
9. Comparer les totaux avec des requêtes de contrôle exécutées par l’exploitant sur un instantané cohérent. Les tests locaux de livraison ne constituent pas cette validation métier sur les comptes réels.

Le navigateur affiche les heures dans sa zone locale et les séries mensuelles sont calculées en UTC. Les journaux du service ne doivent pas contenir les corps de connexion, secrets ou cookies. Le modèle Nginx réécrit l’IP transmise ; le service ne fait confiance qu’aux proxies loopback.

## Phases suivantes

Après validation du tableau de bord : journal d’administration, nominations et révocations, blocage de compte avec motif, politique d’inscription par pays appliquée également dans Cashpay Web, files d’approbation/rejet et services financiers. Les règles de pays/province et les contrôles PIN des moteurs existants devront être conservés. Aucune nouvelle table de permissions ni mutation simulée n’est introduite pour anticiper ces phases.
