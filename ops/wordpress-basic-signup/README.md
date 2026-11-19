# Inscription directe Basique — 1.0.1

Plugin indépendant, prévu uniquement pour `/basique/`. Il ne modifie ni le relais Elementor existant, ni `/inscription/`, ni les comptes et essais existants.

## Parcours

La page affiche une landing et le formulaire `inrcy_basic_signup`. Après la création réussie du compte, les identifiants sont présentés avec le renderer d’accès 1.6.1 : mot de passe temporaire masqué, Afficher/Copier et ouverture de l’application par POST du ticket à usage unique. Aucun rendez-vous ni bouton flottant de réservation n’est proposé sur cette page. L’application prend ensuite en charge le changement du mot de passe, `/activer-mon-compte`, le choix des trois packs et Stripe.

Le backend doit traiter ce parcours comme une inscription sans essai et attendre le paiement avant d’activer les outils payants. La mention près du bouton est « Résiliation avec préavis : un renouvellement mensuel supplémentaire. » Ce plugin ne crée aucune session Stripe et ne modifie aucun e-mail.

## Configuration serveur

La constante existante `INRCY_TRIAL_SIGNUP_TOKEN` de `wp-config.php` est réutilisée en priorité. Si elle est absente ou vide, un administrateur peut enregistrer le secret du backend dans Réglages > Inscription Basique iNrCy. Cette option est écrite avec `autoload=false`. Le champ reste toujours vide à l’affichage ; laisser vide conserve la valeur enregistrée. Aucun import de secret depuis des snippets ou d’autres tables n’est réalisé.

Le secret ne figure ni dans le HTML, ni dans les URL, ni dans le JavaScript, ni dans une réponse AJAX. Il est envoyé exclusivement dans l’en-tête `x-trial-signup-secret` de la requête HTTPS serveur vers l’URL fixe `https://app.inrcy.com/api/public/basic-signup`. Les redirections de cette requête sont désactivées. Une configuration absente ferme le formulaire sans appeler le backend.

## Contrat API

Requête JSON : `signup_mode: "direct_basic"`, `source: "wordpress-basique"`, `language: "fr"`, `first_name`, `last_name`, `email`, `company_name`, `phone`, `consent: true`, `website: ""` et les champs d’attribution autorisés par liste blanche. Le mode et la source sont imposés par PHP ; les valeurs du navigateur ne les remplacent pas. Les noms `form_fields[...]` permettent au script d’attribution existant de reconnaître le formulaire et de fournir son identifiant d’événement, sans toucher au parcours existant.

Réponse attendue : `{ok: true, direct_signup: true, activation_required: true, trial_days: 0, trial_end_at: null, signup_access: {email, password, ticket, expires_at, login_url}}`, où `login_url` vaut exactement `https://app.inrcy.com/api/auth/signup-access`. Les quatre marqueurs du parcours sans essai sont contrôlés strictement avant transmission du reçu ; une réponse d’essai ou d’un ancien backend est rejetée. Un ticket vide reste accepté pour afficher les identifiants et ouvrir la connexion avec l’e-mail prérempli. L’e-mail doit correspondre à la demande. La réponse WordPress transmet seulement ces quatre marqueurs validés et `inrcy_signup_access`, jamais le reste de la réponse backend ni un jeton de réservation. Le contrôleur JavaScript vérifie à nouveau les marqueurs avant d’afficher les accès.

Les identifiants restent dans la réponse AJAX et la mémoire de la page. Ils ne sont pas persistés, envoyés au suivi ou placés en URL. Fermer la modale ou quitter la page les efface. Une perte de réponse après création nécessite la récupération normale du compte ; le plugin ne redemande jamais un mot de passe existant au backend.

## Installation et publication

1. Déployer d’abord le backend compatible et le parcours applicatif sans essai.
2. Installer l’archive de ce plugin, sans remplacer le plugin Rendez-vous existant.
3. Vérifier la configuration serveur dans sa page de réglages. Ne jamais saisir un secret dans un shortcode ou Elementor.
4. Utiliser « Créer ou retrouver le brouillon ». L’action exige les droits administrateur et un nonce. Elle crée seulement un brouillon `/basique` avec `[inrcy_basic_signup]` si le chemin est libre. Si une page existe, elle est ouverte en édition sans être modifiée. Rien n’est publié automatiquement.
5. Prévisualiser le brouillon et vérifier le formulaire, la modale d’accès, le nouvel onglet, le changement du mot de passe, les trois offres et Stripe. Vérifier en parallèle que `/inscription/` conserve son parcours d’essai et de rendez-vous.
6. Publier la page via WordPress une fois ces contrôles terminés. Exclure `/basique/` du cache de page pour conserver un nonce frais ; la réponse AJAX est toujours non mise en cache.

Le template autonome utilise `wp_head`, `wp_body_open` et `wp_footer` : les mécanismes de consentement existants peuvent continuer à fonctionner. Il n’inclut pas le header commercial de l’essai. Sur cette page seulement, les anciens handles `inrcy-visio-booking` sont désenregistrés de la file d’affichage. Le renderer copié utilise `inrcyBasicSignupAccessConfig` avec réservation désactivée. Les autres pages et réglages restent indépendants.

## Sources et archive

`basic-access.js` et `basic-access.css` proviennent de l’accès immédiat WordPress 1.6.1. Seuls le nom de la fonction principale et le nom de configuration JS changent pour isoler la page. Le logo est identique. Les tests vérifient ces copies contre les sources existantes.

Depuis la racine du dépôt :

```sh
node ops/wordpress-basic-signup/build-package.mjs /chemin/absolu/vers/outputs
node --test --test-isolation=none --experimental-strip-types tests/wordpress-basic-signup/*.test.mts
```

L’archive reproductible contient uniquement les fichiers du plugin, sous `inrcy-basic-signup/`, avec un manifeste SHA-256 séparé. Elle ne contient aucune valeur de configuration.
