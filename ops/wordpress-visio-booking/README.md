# Rendez-vous visio et accès immédiat après inscription

Extension WordPress autonome pour le formulaire Elementor `essai_inrcy_30j` (`405c24a`). Elle ne remplace pas l’inscription existante et ne rappelle jamais l’API de création du compte. Elle récupère le jeton sécurisé renvoyé par le succès existant, puis affiche la modale de réservation. Le même parcours peut être rouvert depuis le lien personnel inclus dans l’e-mail d’invitation.

## Parcours

1. L’inscription est validée normalement.
2. La modale propose un rendez-vous de présentation iNrCy.
3. Si le professionnel accepte, tous les créneaux proposés sont chargés.
4. La réservation crée un rendez-vous bleu de 45 minutes dans l’agenda du membre attribué et dans la vue partagée. Un départ est proposé chaque heure de 9 h à 18 h.
5. Google Meet et les invitations sont créés automatiquement.
6. Après « Je choisirai plus tard », une fermeture de la proposition, ou « Terminer » après la réservation, la modale présente les identifiants du compte qui vient d’être créé : e-mail et mot de passe temporaire masqué, avec Afficher/Copier.
7. « Accéder à mon compte » soumet le reçu de connexion à usage unique à l’application dans un nouvel onglet. L’e-mail de bienvenue reste envoyé en complément. La durée de l’essai existant est inchangée.

La sélection affiche six jours disponibles à la fois, avec des flèches pour passer aux jours suivants ou précédents. Les rendez-vous sont proposés du lundi au samedi, jamais le dimanche. Un créneau peut être réservé dès quatre heures après l'instant présent, y compris le jour même s'il est disponible (par exemple, à 8 h pour 12 h).

L’attribution privilégie automatiquement une personne libre parmi Océane, Apolline et Jimmy. Si les trois agendas sont déjà occupés, le rendez-vous reste réservable et est attribué à la personne la moins chargée à cette heure ; les chevauchements pourront ensuite être réorganisés manuellement.

Le bouton « Je choisirai plus tard » ouvre les accès sans réserver de rendez-vous. Après fermeture des accès, le rappel de réservation reste disponible si aucun créneau n’a été réservé. Le consentement téléphonique reste inchangé.

## Confidentialité et reprise

La réponse de création du nouveau compte contient `signup_access` avec `email`, `password`, `ticket`, `expires_at` et `login_url`. L’extension transmet ces champs uniquement dans la réponse AJAX de cette inscription, sous `inrcy_signup_access`. Elle ne les enregistre dans aucune option, session, transient ni journal WordPress. Les identifiants restent uniquement dans la mémoire de la page et dans les champs privés de la modale ; ils sont effacés à sa fermeture et lors de la sortie de page. Aucun secret n’est placé dans les paramètres d’URL, le stockage navigateur ou les événements de suivi.

Le nouvel onglet reçoit seulement le `ticket` dans un formulaire POST vers l’adresse fixe `https://app.inrcy.com/api/auth/signup-access`. Le formulaire conserve l’en-tête Origin et isole l’onglet via `rel="noopener"`. Le serveur de l’application vérifie et consomme le reçu avant d’ouvrir la session.

Si la connexion directe n’a pas pu être préparée (`ticket` vide) ou a expiré, les identifiants du nouveau compte restent affichés et un lien permet d’ouvrir la connexion avec l’e-mail prérempli. La réservation peut rester désactivée dans les réglages : l’écran d’accès est alors proposé directement après l’inscription. Un ancien lien de rendez-vous ou un rechargement de page ne permet jamais de récupérer les accès d’un compte existant.

## Mise à jour 1.6.1

Le réglage de réservation accepte les booléens JavaScript et les valeurs sérialisées par WordPress (`"1"` pour activé, `""` pour désactivé). Une réservation désactivée ouvre directement les accès du nouveau compte.

Déployer d’abord le backend d’inscription et de connexion de l’application, puis installer cette version de l’extension. Vérifier une nouvelle inscription dans les deux branches (sans rendez-vous et réservation confirmée), l’ouverture du nouvel onglet et la modale de changement du mot de passe temporaire dans l’application. En cas de retour à l’ancienne extension, le parcours de rendez-vous et l’e-mail de bienvenue restent utilisables.

## Installation

Depuis la racine du dépôt, construire l’archive avec les sources actuelles :

```sh
node scripts/build-wordpress-visio-booking.mjs
node scripts/build-wordpress-visio-booking.mjs --check
```

Le livrable est `ops/inrcy-visio-booking.zip`. Il contient le dossier `inrcy-visio-booking/` avec les fichiers PHP, JavaScript, CSS, README et le logo. Le manifeste `ops/inrcy-visio-booking.manifest.json` indique la version et les empreintes SHA-256 de l’archive et de chaque fichier. À sources identiques, l’archive est identique ; `--check` refuse un livrable absent ou périmé sans modifier de fichier. Après chaque modification des sources, reconstruire et vérifier les deux livrables avant livraison.

Installer le ZIP vérifié dans **Extensions > Ajouter une extension > Téléverser une extension**, puis activer **iNrCy — Rendez-vous visio après inscription**. La construction locale ne modifie aucun site WordPress.

À l’installation, la proposition publique de rendez-vous est désactivée. Dans **Réglages > Rendez-vous visio iNrCy**, le bouton de test ouvre le formulaire avec la réservation uniquement pour un administrateur WordPress connecté. Les accès du nouveau compte sont disponibles pour toutes les inscriptions réussies qui renvoient le reçu backend.

Après un essai complet réussi, cocher **Proposer le rendez-vous à tous les professionnels après une inscription réussie** sur cette même page pour ouvrir le parcours au public.
