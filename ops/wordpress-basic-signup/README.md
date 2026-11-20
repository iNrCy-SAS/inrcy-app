# Espace Basique iNrCy — 1.2.0

La présentation et la navigation reprennent le site iNrCy. Le formulaire, les liens d’accès à l’application et les textes d’abonnement restent propres à l’entrée Basique. La mise à jour depuis 1.1.0 ajoute les deux pages enfants Blog et iNr’Annuaire, à préparer via le réglage existant et à publier pour rendre les deux entrées du menu accessibles. L’annuaire utilise le shortcode de l’annuaire d’origine.

Mini-site dans le WordPress actuel, sous `/basique/`, sans nouveau domaine. L’offre présentée est Basique à **29 € HT par mois**, avec **50 crédits médias mensuels**. Les onze canaux et les outils proviennent des politiques réelles de l’application ; les comptes connectés doivent être compatibles. L’application conserve la comparaison des trois packs et l’activation après paiement.

## Pages et bascule

La racine existante, sa valeur `inrcy_basic_signup_page_id` et son shortcode `[inrcy_basic_signup]` sont conservés. **Le mini-site est désactivé par défaut.** Tant que sa bascule est OFF, la racine garde la landing existante. Les nouveaux enfants sont fermés aux visiteurs : réponse neutre 503, noindex et non mise en cache, sans formulaire ni navigation. Les aperçus d’administrateur authentifié restent disponibles. Le shortcode enfant lui-même refuse aussi un rendu public lorsque la bascule est OFF.

| Vue | URL | Shortcode enfant |
| --- | --- | --- |
| Accueil | /basique/ | Racine existante : [inrcy_basic_signup] |
| Fonctionnalités | /basique/fonctionnalites/ | [inrcy_basic_page view="features"] |
| Tarif | /basique/tarif/ | [inrcy_basic_page view="pricing"] |
| Blog | /basique/blog/ | [inrcy_basic_page view="blog"] |
| iNr’Annuaire | /basique/annuaire/ | [inrcy_basic_page view="directory"] |
| FAQ | /basique/faq/ | [inrcy_basic_page view="faq"] |
| Inscription | /basique/inscription/ | [inrcy_basic_page view="signup"] |
| Contact | /basique/contact/ | [inrcy_basic_page view="contact"] |
| Conditions | /basique/conditions/ | [inrcy_basic_page view="terms"] |
| Confidentialité | /basique/confidentialite/ | [inrcy_basic_page view="privacy"] |
| Cookies | /basique/cookies/ | [inrcy_basic_page view="cookies"] |
| Mentions légales | /basique/mentions-legales/ | [inrcy_basic_page view="legal"] |

Les boutons de préparation et de bascule exigent `manage_options` et un nonce. La préparation crée uniquement les enfants manquants **en brouillon**. Elle ne remplace ni contenu, ni statut d’une page existante. Un conflit de vue est signalé. Un verrou SQL `INSERT IGNORE` à propriétaire unique évite les créations concurrentes ; récupération après 300 secondes et libération par comparaison exacte.

La bascule ON vérifie dans WordPress les douze chemins réels : tous doivent être publiés, non protégés par mot de passe, avec la vue attendue. Elle exige aussi les trois corps juridiques revus, le consentement et le shortcode Complianz. Elle ne publie jamais de page. Les trois textes dédiés sont embarqués en entier dans `includes/legal/` : 47 articles, 38 rubriques et 19 sections ; le renderer ne récupère aucun texte juridique sur Internet.

## Parcours et accès

Le formulaire conserve le contrat `inrcy_basic_signup`. Après succès : identifiant et mot de passe provisoire masqué, Afficher/Copier, puis ouverture de l’application dans un nouvel onglet par POST du ticket à usage unique. La réservation et son bouton flottant sont désactivés. Le mot de passe, le choix de l’offre et le paiement restent gérés dans l’application. La règle de résiliation est conservée dans les conditions et dans le parcours applicatif ; elle n’est pas répétée dans le bloc commercial du formulaire.

Le lien de connexion est `https://app.inrcy.com/login?entry=basique`. Le renderer d’accès reprend la version vérifiée 1.6.1 avec des différences bornées et testées : nom de fonction/configuration propres ; `?entry=basique` ajouté à **l’action** du POST ; même contexte dans les deux replis de connexion avec e-mail. Le `login_url` reçu et son contrôle d’égalité exact restent `https://app.inrcy.com/api/auth/signup-access`. Le corps de ce POST contient **uniquement ticket**. Aucun identifiant privé dans une URL, le stockage du navigateur ou le suivi. Fermer la modale/quitter la page efface le reçu en mémoire. Une réponse perdue après création appelle la récupération normale du compte ; aucun renvoi d’un mot de passe existant.

## Backend et secret inchangés

La constante serveur existante `INRCY_TRIAL_SIGNUP_TOKEN` est prioritaire. Si elle est vide ou absente, le réglage administrateur utilise une option `autoload=false`. Le champ secret reste vide à l’affichage ; aucune lecture d’autres snippets/tables, aucun secret dans HTML, configuration JS, URL, suivi ou réponse AJAX.

PHP impose `signup_mode: "direct_basic"`, `source: "wordpress-basique"`, `language: "fr"`. Les autres champs sont prénom, nom, e-mail, société facultative, téléphone, consentement et honeypot vide. L’attribution est filtrée par liste blanche. La requête serveur utilise uniquement l’URL HTTPS fixe `https://app.inrcy.com/api/public/basic-signup`, l’en-tête `x-trial-signup-secret`, un délai de 20 secondes et aucune redirection.

Le reçu backend doit avoir strictement `ok: true`, `direct_signup: true`, `activation_required: true`, `trial_days: 0`, `trial_end_at: null` et `signup_access: {email,password,ticket,expires_at,login_url}`. L’e-mail doit correspondre à la demande, l’endpoint doit être exact, et les champs supplémentaires sont supprimés. Un ticket vide autorise le repli manuel. PHP puis le contrôleur JS refusent les réponses d’un autre parcours. Aucun paiement n’est créé par le plugin. Aucun e-mail modifié.

## Attribution, cookies et métadonnées

La copie dédiée `basic-meta-attribution.js` est chargée **synchroniquement au début de wp_head**, seulement dans le nouveau mini-site. Elle pose le même guard que le snippet global inchangé : ce dernier ne démarre donc pas une deuxième fois dans cet espace. Son démarrage attend le DOM. Le formulaire public est reconnu par son nom exact ; le formulaire privé d’accès est exclu. Le Lead porte le libellé Basique et n’est envoyé au Pixel qu’avec consentement marketing. Le mécanisme Pixel lui-même et les anciennes pages ne sont pas modifiés. UTM, page d’arrivée, source de l’événement et identifiant de déduplication persistent pendant la navigation interne ; aucune navigation ne soumet de formulaire.

La page Cookies utilise le moteur Complianz existant, via le shortcode exact `[cmplz-document type="cookie-statement" region="eu"]`. Elle conserve les conteneurs de liste des services et de gestion du consentement. Aucun inventaire statique, nouvelle catégorie ou modification de préférence globale. Les href connus du site général sont remappés vers les équivalents Basique côté PHP, y compris sans JS ; l’adaptation DOM ciblée couvre les liens de bandeau créés ensuite. Les ancres locales, requêtes, fragments, liens externes et contrôles restent fonctionnels. Les métadonnées de document canoniques globales de Complianz ne sont pas réassignées.

La source Complianz 7.5.7 confirme que sa détection automatique ne voit pas le shortcode contenu dans notre wrapper. Sur la seule vue Cookies rendue, le plugin charge donc explicitement le handle CSS natif `cmplz-document` ou `cmplz-document-grid`, selon le réglage existant, ainsi que ses styles personnalisés et la classe body `cmplz-document`. Le moteur de bandeau global initialise lui-même les commandes dans `.cmplz-manage-consent-container` ; la liste des services est produite côté serveur par `cmplz_used_cookies()`. Il n’existe pas de second script de document à inventer. Aucun identifiant de politique, méta de page ou réglage Complianz n’est écrit.

Le template autonome appelle `wp_head`, `wp_body_open` et `wp_footer`. Les en-têtes/footer promotionnels Astra/Elementor ne sont pas inclus. Les anciens handles visio sont retirés uniquement des pages de ce plugin. Les filtres SEO sont limités au nouveau rendu : titre, description, canonical, OpenGraph et Twitter dédiés ; le graphe Rank Math général est remplacé par un JSON-LD Basique local (29 € HT mensuels et FAQ réelle). Aperçus administrateur : noindex et canonical public sans nonce. Les autres pages gardent leurs filtres et leur offre actuels.

Sources primaires d’intégration : [Complianz document 7.5.7](https://github.com/complianz/complianz-gdpr/blob/v7.5.7/documents/class-document.php), [liste des services côté serveur](https://github.com/complianz/complianz-gdpr/blob/v7.5.7/functions.php#L1875-L2013), [moteur de bandeau](https://github.com/complianz/complianz-gdpr/blob/v7.5.7/cookiebanner/class-banner-loader.php), [initialisation navigateur](https://github.com/complianz/complianz-gdpr/blob/v7.5.7/cookiebanner/js/complianz.js), [Rank Math métadonnées](https://rankmath.com/docs/filters-and-hooks/frontend/meta-data/), [OpenGraph](https://rankmath.com/docs/filters-and-hooks/frontend/open-graph/), [JSON-LD](https://rankmath.com/docs/filters-and-hooks/frontend/rich-snippets/).

## Mise en service initiale de la version 1.1.0

1. Préparer et vérifier l’application compatible avec les liens `entry=basique`, puis la déployer avant la bascule visiteurs. Le plugin OFF, les brouillons, leur aperçu et la publication des enfants encore fermés peuvent être préparés d’abord ; attendre ensuite que l’application soit READY avant ON, pour que ses nouveaux liens dédiés trouvent des pages prêtes. Conserver une sauvegarde du plugin 1.0.1 et les valeurs des options de bascule/pages, sans exporter de secret.
2. Mettre **à jour le plugin existant** `inrcy-basic-signup` avec l’archive 1.1.0 ; ne pas installer une deuxième copie. Vérifier que la bascule est OFF. Aucune page n’est créée/publiée lors de l’activation du plugin.
3. Dans Réglages > Inscription Basique iNrCy, vérifier le statut serveur, puis « Préparer les pages en brouillon ». La racine existante 12815 reste intacte. Résoudre manuellement tout conflit signalé : aucune page existante n’est écrasée.
4. Ouvrir « Prévisualiser le mini-site » en administrateur, puis les dix vues via la navigation d’aperçu. Vérifier desktop/mobile, les textes intégraux et liens du consentement, le formulaire compact et l’identité Basique du login/reset. Le nonce d’aperçu ne remplace pas l’authentification administrateur.
5. Dans le **vrai aperçu WordPress**, vérifier les assets Complianz, la liste des services/cookies et les commandes de préférences. Vérifier le bandeau dynamique et ses liens Basique. Les tests locaux vérifient l’intégration mais ne reproduisent pas les réglages du CMP de production. Vérifier Meta avec consentement refusé puis accepté, sans inscription réelle non autorisée.
6. Après revue et autorisation de publication, publier les neuf enfants dans WordPress, avec leur shortcode exact et sans protection par mot de passe. La bascule encore OFF laisse leurs routes publiques fermées (503/noindex). Vérifier que les dix chemins sont prêts.
7. Cocher « Activer le mini-site revu pour les visiteurs » puis enregistrer. L’action refuse toute page manquante, brouillon, conflit, protection ou dépendance absente ; l’unique option de bascule est modifiée après validation.
8. Purger le cache WordPress/CDN et les CSS/JS. Exclure `/basique/` et ses enfants du cache de page pour conserver les nonces frais ; PHP pose aussi les protections de cache et l’AJAX est non mis en cache.
9. Vérifier par HTTP et navigateur les dix routes publiques, versions/hash des assets, liens/aperçus sociaux, cookie manager et absence de sortie vers les pages commerciales générales. Si un test d’inscription est autorisé, contrôler reçu, nouvel onglet avec ticket seul, changement du mot de passe, trois offres et paiement explicite. Un contrôle d’interface seul ne vaut pas test de souscription réelle.
10. Vérifier séparément que `/inscription/` garde son formulaire, ses assets visio 1.6.1, son parcours et ses rendez-vous. Ne modifier ni son contenu ni le snippet d’attribution global.

**Retour arrière :** décocher la bascule puis enregistrer et purger les caches. La racine retrouve la landing existante ; les enfants repassent 503/noindex sans formulaire. Pour un retour arrière complet, coordonner aussi la restauration de la version applicative correspondante : une application qui utilise les nouveaux liens juridiques ne doit pas continuer à diriger vers des enfants fermés. Aucune page ni aucun compte n’est supprimé, et aucun abonnement n’est modifié. Dépublier les enfants reste une action WordPress explicite si souhaité. Le retour au ZIP précédent est possible après bascule OFF ; conserver les sauvegardes et vérifier l’ancienne racine avant de relancer une campagne.

## Vérification et paquet

Les tests rendent **les vrais fichiers PHP du plugin** dans un shim WordPress local ; aucun retrait de balises PHP par regex. Le binaire vient de `PHP_BINARY` ou de `php` dans PATH : son absence fait échouer clairement les tests. Ubuntu CI utilise son PHP ; Windows peut utiliser un runtime portable officiel sans l’ajouter au dépôt.

```powershell
$env:PHP_BINARY='C:/chemin/vers/php.exe'
node --test --test-isolation=none --experimental-strip-types tests/wordpress-basic-signup/*.test.mts
node ops/wordpress-basic-signup/build-package.mjs C:/chemin/absolu/outputs
```

Le preview local n’accède à aucun .env/wp-config/secret. Il sert une liste blanche de vues/assets depuis un docroot dédié et refuse tout POST. Bind local uniquement, depuis la racine du dépôt :

```powershell
& $env:PHP_BINARY -n -S 127.0.0.1:8789 -t tests/wordpress-basic-signup/preview-root tests/wordpress-basic-signup/preview-router.php
```

Puis ouvrir `http://127.0.0.1:8789/basique/`. Les documents sont les corps embarqués ; le CMP du shim reste synthétique et le formulaire ne peut soumettre aucune requête réelle.

L’archive déterministe contient uniquement la liste explicite des fichiers du plugin sous `inrcy-basic-signup/`, dont les trois corps juridiques complets. Aucun test, source externe téléchargée, configuration, runtime PHP ou secret. Le builder contrôle les empreintes de chaque entrée après réouverture du ZIP et produit un manifeste SHA-256 séparé.
