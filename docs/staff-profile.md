# Profil du compte connecté

Le menu supérieur affiche `users.last_name` et la photo réelle du compte connecté, avec une icône de profil si la photo manque ou ne peut être chargée. Il ouvre **Mon profil**, **Sécurité et PIN**, et la déconnexion. Les Admins et Gestionnaires disposent de leur propre profil ; cela ne donne aucun accès supplémentaire aux comptes des autres utilisateurs.

`/profile` affiche l’identité professionnelle, l’ID Wallet, l’e-mail et le rôle. Ces champs sont consultatifs. Les changements proposés concernent uniquement sa propre photo et son PIN ; l’API ignore tout identifiant de cible fourni par le navigateur.

La photo utilise le stockage existant d’inscription : JPEG/PNG de 5 Mo maximum, vérification et réencodage par Sharp, propriété du média contrôlée côté serveur. La production nécessite la configuration existante `CASH_PAY_AVATAR_DIR` vers le dossier public des avatars CashPay Web et les droits d’écriture correspondants. Une configuration absente provoque une erreur explicite. Aucun faux avatar n’est enregistré. Préserver les médias et `ADMIN_STATE_DIR` aux mises à jour.

Chaque modification exige le PIN actuel, une session active, l’origine autorisée et le jeton CSRF. Les tentatives de PIN incorrectes sont limitées. Un nouveau PIN doit être différent et confirmé, composé de quatre à six chiffres ; il est haché avec bcrypt. L’écriture, l’audit et les alertes sont atomiques : un échec annule la modification. Aucun PIN ni hash n’est envoyé dans les réponses, e-mails ou journaux.

Le PIN est celui du compte CashPay partagé avec les applications clientes. Son changement ferme toutes les sessions de ce compte sur **ce portail admin**, puis demande une nouvelle connexion OTP/PIN. Il ne prétend pas révoquer les sessions des autres applications CashPay, qui possèdent leurs propres mécanismes. Les autres utilisateurs du portail restent connectés.

Aucune nouvelle table ou colonne. Les alertes utilisent les deux tables de [sql/admin-communications.sql](sql/admin-communications.sql), qui doivent déjà être installées. Mise à jour habituelle du clone, contrôle `npm run check`, puis redémarrage PM2 ; conserver le fichier d’environnement et les données privées existantes.

Vérifications hors production : API/SQL et navigateur mobile/desktop, lecture de l’avatar réel, menu, refus de média appartenant à un autre opérateur, PIN/CSRF, hachage, annulation sur échec d’audit, notifications, fermeture des sessions concernées et connexion avec le nouveau PIN. Aucun test livré dans le dépôt ni service de production utilisé.
