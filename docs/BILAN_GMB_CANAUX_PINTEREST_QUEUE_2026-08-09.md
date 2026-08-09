# Bilan — Google Business, états des canaux, Pinterest et Supabase Queue

Date : 9 août 2026

## Conclusion immédiate

L’erreur Google Business est identifiée et corrigée dans le code livré. Elle ne venait ni de l’image choisie, ni du mélange « vidéo pour les réseaux + image pour Google Business », ni d’un refus de Google.

La publication a été arrêtée dans le worker inrCy avant le premier appel à Google Business. Le helper Google cherchait par erreur la session navigateur dans une tâche serveur exécutée en arrière-plan. Comme cette tâche ne possède pas les cookies du navigateur, elle a renvoyé `Non authentifié.`. L’ancien classificateur a ensuite interprété à tort ce message interne comme l’expiration du canal Google Business.

## Preuves relevées dans les journaux

- Publication : `8532e161-e2ca-4ca0-9caf-97c125dc4596`.
- Échec Google Business à 20:11:08, soit 18:11 UTC.
- Étape : `exception`.
- Erreur brute : `Non authentifié.`.
- Message affiché : `Votre session a expiré. Merci de vous reconnecter.`.
- L’intégration Google Business était pourtant enregistrée `connected`.
- Son jeton d’accès était valable jusqu’à 18:59 UTC, donc encore valide au moment de l’échec.
- Un jeton de renouvellement était également présent.
- Le marqueur `publication_authentication_failed` a été écrit à 18:11 UTC par ce faux diagnostic.

La cliente n’a donc pas sélectionné un canal Google Business réellement expiré. Le canal paraissait légitimement connecté au départ, puis cette erreur interne a créé après coup un faux état « reconnexion nécessaire ».

## Corrections appliquées

### Google Business

- Le worker transmet maintenant explicitement l’identité serveur déjà authentifiée au helper Google Business ; il ne dépend plus des cookies du navigateur.
- Un jeton Google encore valide est utilisable même si aucun renouvellement n’est nécessaire à cet instant.
- Le compte Google et l’établissement cible doivent tous deux exister avant qu’un canal puisse être considéré publiable.

### Règle unique pour les sept canaux OAuth

La même règle est désormais partagée par le dashboard, l’API Booster et le worker pour Facebook, Instagram, LinkedIn, TikTok, YouTube, Pinterest et Google Business :

- vert et sélectionnable uniquement si l’état officiel est réellement `connected` et si la cible nécessaire à la publication existe ;
- orange et non sélectionnable si les identifiants sont expirés ou si une reconnexion est réellement requise ;
- contrôle serveur supplémentaire juste avant l’appel au fournisseur, afin qu’un canal devenu invalide entre l’ouverture de Booster et l’envoi ne parte jamais ;
- une reconnexion réussie efface les anciens marqueurs ;
- un ancien worker ne peut plus remettre en orange une connexion renouvelée plus récemment.

### Fin des faux « jeton expiré »

La politique est centralisée pour les sept fournisseurs. Les cas suivants ne rendent plus un canal orange :

- session inrCy absente ou expirée ;
- panne réseau, délai dépassé ou indisponibilité temporaire ;
- quota ou limitation du fournisseur ;
- média inaccessible, invalide ou refusé ;
- erreur métier ou politique de contenu ;
- simple code HTTP 403 sans preuve d’un problème OAuth.

Seule une preuve d’authentification provenant réellement du fournisseur peut désormais poser le marqueur de reconnexion. Les expirations connues des jetons de renouvellement LinkedIn, TikTok et Pinterest sont enregistrées et contrôlées.

## Image Google Business et publication mixte

Le mixage a fonctionné : la vidéo a été envoyée aux canaux choisis et l’image a été affectée à Google Business. Les tests de non-régression couvrent explicitement ce scénario.

Dans cet incident précis, Google n’a jamais reçu la requête. L’image ne peut donc pas être la cause de cet échec. Elle devra naturellement rester conforme aux règles Google (JPG ou PNG, taille autorisée et qualité suffisante). La limite de 30 secondes concerne la vidéo Google Business, pas une image de remplacement.

Référence officielle : https://support.google.com/business/answer/6103862?hl=fr

## Courriel Pinterest

Pinterest indique que l’Épingle reste visible, mais que son audio a été coupé en Australie après reconnaissance d’un morceau protégé attribué à Warner Music Group. Ce n’est pas un échec technique de publication inrCy.

À faire :

- ne faire appel que si la cliente détient réellement les droits ou une licence couvrant cette diffusion ;
- sinon utiliser une musique libre de droits ou licenciée pour un usage commercial et pour les territoires concernés ;
- lorsque c’est possible, ajouter la musique depuis la bibliothèque autorisée de Pinterest plutôt que d’intégrer une piste commerciale dans le fichier vidéo.

Références officielles : https://policy.pinterest.com/fr/music-terms-of-use et https://policy.pinterest.com/fr/copyright

## Supabase Queue

Supabase Queue est une file de messages durable basée sur Postgres/`pgmq`. Elle peut être utile plus tard pour distribuer les publications canal par canal, reprendre les tâches après une panne, exécuter des transformations vidéo ou gérer des relances contrôlées.

Son activation seule n’accélère rien : il faut également un producteur, un consumer/worker, une fenêtre de visibilité, de l’idempotence, une politique de relance, un traitement des échecs définitifs et du monitoring. Le moteur inrCy possède déjà des tâches durables par canal, des verrous et de l’idempotence. Une seconde file branchée sans migration organisée risquerait surtout de créer des doublons.

Recommandation actuelle : ne pas migrer les publications vers Queue dans ce correctif. La laisser inutilisée ne stabilise ni ne déstabilise l’application. Si une migration est décidée plus tard, utiliser une file durable « Basic », un worker serveur unique et idempotent, puis migrer progressivement un type de tâche à la fois.

Références officielles : https://supabase.com/docs/guides/queues et https://supabase.com/docs/guides/queues/quickstart

## Vérifications effectuées

- 259/259 tests du dashboard réussis.
- 206/206 tests du système de publication réussis.
- Vérification TypeScript réussie.
- ESLint réussi sur tous les fichiers modifiés.
- Les tests couvrent notamment : publication mixte, état orange, blocage Booster, recontrôle dans le worker, erreurs OAuth réelles, erreurs internes, réseau, quotas et médias.

## Mise en production

Les corrections sont présentes dans le ZIP Windows livré, mais elles ne deviennent effectives sur le site qu’après déploiement de ce code.

Après le déploiement, il est conseillé de reconnecter Google Business une seule fois pour effacer proprement le faux marqueur déjà enregistré lors de l’incident. Ensuite, actualiser le dashboard et vérifier que le canal redevient vert et sélectionnable. Une publication de contrôle avec texte + image permettra de valider le parcours réel jusqu’à Google.

Un canal vert signifie désormais que l’authentification et la cible de publication sont valides. Cela ne peut toutefois pas garantir qu’un fournisseur acceptera chaque contenu : une panne externe, un quota, une règle de format ou une politique de contenu peuvent encore produire un échec opérationnel, mais ces échecs ne seront plus confondus avec une expiration OAuth.
