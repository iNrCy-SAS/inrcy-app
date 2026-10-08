# X Ads : création native en pause

Ce document décrit le parcours implémenté. Il ne confirme pas les droits réels d’une application X, la présence de la migration en production ou l’activation d’un environnement. La préparation et l’enregistrement d’un brouillon restent possibles quand la création native est verrouillée.

## Configuration et approbation

Le connecteur utilise **X Ads API v12 et OAuth 1.0a**, séparément du connecteur X organique OAuth 2.0.

| Variable serveur | Condition appliquée |
| --- | --- |
| `X_ADS_API_KEY` et `X_ADS_API_SECRET` | Identifiants de l’application Ads, disponibles uniquement côté serveur. |
| `X_ADS_API_VERSION` | `12` ; valeur par défaut `12`, autres versions refusées. |
| `X_ADS_STANDARD_ACCESS_APPROVED` | Exactement `true`, après vérification réelle de l’approbation Standard de cette application. |
| `X_ADS_STANDARD_ACCESS_APPROVED_AT` | Instant ISO valide avec fuseau, correspondant à cette approbation ; il ne peut pas être futur. |
| `X_ADS_APPROVED_APP_KEY_SHA256` | SHA-256 hexadécimal de la valeur effective de `X_ADS_API_KEY`, pour l’application effectivement approuvée. |
| `X_ADS_PAUSED_CREATION_ENABLED` | Exactement `true` pour autoriser ce seul parcours en pause ; fermé par défaut. `TRUE`, `1` ou un flag d’un autre canal ne l’ouvrent pas. |

Ces variables sont une **attestation de configuration serveur**, pas une approbation délivrée par X. Les renseigner ne crée aucun droit API. Elles doivent correspondre à une vérification réelle dans X Developer et à des identifiants réellement autorisés. La découverte réussie d’un compte ou un rôle `ACCOUNT_ADMIN` ne prouvent pas l’approbation Standard de l’application.

Après l’approbation, l’utilisateur doit **reconnecter X Ads**. Le callback OAuth enregistre côté serveur `oauth1a_app_key_hash` et `oauth1a_token_issued_at`. Le contrôle exige le même hash d’application et une émission du jeton strictement postérieure à l’instant d’approbation, sans date future. Une connexion historique sans ces métadonnées reste non vérifiée. Les clés, secrets, jetons et hashes privés ne sont jamais fournis au client.

Les contrôles habituels d’authentification, d’accès premium et d’accès au canal continuent de s’appliquer. Le compte associé est relu : compte accepté, rôle permettant de gérer les campagnes, financement disponible en EUR, identité authentifiée correspondant à celle de la connexion. Un changement de compte, de jeton ou de métadonnées invalide l’opération.

## Journal durable requis

La migration locale est `supabase/migrations/20261008181421_ads_prepared_native_paused_store.sql`. Sa livraison ne signifie pas qu’elle a été appliquée. Son application relève d’une opération de déploiement distincte.

Elle autorise les enregistrements TikTok/X cohérents dans `ads_campaigns` avec les seuls états `draft`, `publishing`, `paused` et `needs_review`, et installe la RPC en lecture seule `public.inrcy_ads_prepared_paused_store_ready()`. Cette fonction est réservée à `service_role` et vérifie la définition exacte et validée de la contrainte installée.

`readPreparedAdsStoreAvailability()` appelle cette RPC en lecture seule. Une RPC absente, une erreur ou une réponse autre que `true` donne `false`. Le contrôle retourne alors `campaign_store_migration_required` et refuse la création native avant le verrou et les écritures publicitaires. Le code ne teste jamais la disponibilité du schéma par une tentative d’écriture.

## Parcours natif actuellement pris en charge

- Objectif `ENGAGEMENTS`, annonce `PROMOTED_TWEETS` en **texte seul**, audience large et placement `ALL_ON_TWITTER`. Les langues décrivent le brief et le texte ; aucun filtre natif de langue n’est transmis.
- Source de financement réelle, active et en EUR, identité native `FULL`, compte et droits revérifiés. Aucun identifiant de compte, d’identité ou de géographie n’est inventé par l’IA.
- `postId: null` crée un nouveau post avec le texte exact, `as_user_id` vérifié et `nullcast=true`. Il ne paraît pas dans le fil organique. L’auteur authentifié doit être cette identité `FULL` ou disposer de `TWEET_COMPOSER`. Un post existant n’est réutilisé que si son auteur et son texte exact sont vérifiés ; aucun ancien post différent n’est choisi automatiquement.
- Le texte respecte la limite pondérée X de 280 via `twitter-text`. Une destination HTTPS et ses UTM sont acceptés uniquement si le lien final normalisé figure comme token exact dans le texte. Le moteur ne supprime ni n’ajoute silencieusement un lien et ne configure pas de suivi de conversion web.
- Géographies issues du catalogue X : identifiant, nom, pays et type exacts sont revérifiés. Une proposition ambiguë exige un choix. Les libellés du brouillon doivent correspondre aux zones natives retenues ; aucun remplacement par un pays entier.
- **Budget quotidien et enchère `MAX` uniquement** : montant quotidien entre 5 et 500 EUR, montant d’enchère positif inférieur ou égal au budget quotidien, précision au centime. Ces bornes sont celles de ce parcours iNrCy, pas une affirmation de minimum universel imposé par X. Un budget total reste en brouillon et n’est jamais converti en budget quotidien.
- Début et fin ISO avec fuseau explicitement enregistrés. Pour une nouvelle création, début au moins 60 secondes après l’horloge serveur ; fin postérieure au début et à l’instant courant ; durée maximale 90 jours. La reprise d’un journal validé peut relire un calendrier déjà commencé, sans déplacer les dates.
- Mots-clés, exclusions de mots-clés, autres objectifs, formats ou stratégies ne sont pas transmis par ce moteur ; ils restent des parcours de préparation.

Les requêtes natives créent la campagne et le groupe avec `entity_status=PAUSED`. L’association `promoted_tweets` est relue `ACTIVE`, conformément à ce type de ressource X ; ce sont ses **parents PAUSED** qui empêchent la diffusion. Aucun endpoint d’activation n’est implémenté par ce moteur. Les routes communes refusent également l’activation, la modification et la suppression X dans ce parcours.

## Consentement, reprise et réconciliation

Le contrôle du brouillon complet est `POST /api/ads/x/preflight` ; il ne réalise que des lectures natives et la vérification du stockage. La réponse publique conserve `publicationEnabled:false`, expose `targetStatus:PAUSED` et fournit les clés de préparation nécessaires à la revue. Un flag ouvert avec une preuve manquante ne suffit pas à rendre le contrôle prêt.

Après confirmation de la dernière page, le client relit le contrôle, enregistre le brouillon exact, puis demande le contrôle sauvegardé en `mode=paused`. La requête de création est liée au propriétaire, à la campagne, à l’empreinte du brouillon et aux ressources fraîches par `nativeConsentKey` et `expectedDraftFingerprint`. Un changement exige une nouvelle revue.

Le store partagé `lib/adsTikTokCampaignStore.ts` conserve `preparedCampaignLock` et `preparedCampaignCheckpoint`, discriminés par fournisseur et empreinte du brouillon. Il utilise une comparaison atomique du propriétaire, du fournisseur, de la version de ligne et du snapshot. Ces champs internes sont exclus de la projection publique.

Le moteur écrit un marqueur `pendingStep` **avant chaque POST**, puis les identifiants natifs confirmés. Les étapes sont `prepared`, `post_created`, `campaign_created`, `line_item_created`, `targeting_created`, `promoted_tweet_created` et `paused_verified`. Les droits et ressources sont revérifiés avant chaque POST ; les objets connus sont relus à chaque étape et avant la confirmation finale.

Un délai dépassé, une réponse incohérente ou une sauvegarde incertaine conserve `pendingStep`/`uncertainStep` et exige un contrôle : **aucune nouvelle tentative automatique** de l’écriture concernée. Une reprise confirmée doit conserver le même compte, la même opération et la même empreinte d’entrée ; les objets déjà connus ne sont pas recréés.

La seule opération distante de suivi disponible pour X est la réconciliation en lecture seule (`action: reconcile` sur la route lifecycle). Elle relit les identifiants connus et les états attendus via `readbackStoredXAdsCampaign`. Elle ne crée rien, n’active rien et ne supprime pas une incertitude du journal. Un résultat inconnu reste à examiner avant une nouvelle tentative.

## Références

- Code : `lib/adsXServer.ts`, `lib/adsXResources.ts`, `lib/adsXResourcesServer.ts`, `lib/adsXPublisherCore.ts`, `lib/adsXPublisherServer.ts` et `lib/adsTikTokCampaignStore.ts`.
- Tests simulés : `tests/ads-x-publisher-contract.test.mts`, `tests/ads-x-native-resources.test.mts`, `tests/ads-prepared-native-client.test.mts` et `tests/ads-prepared-native-ui.test.mjs`.
- Contrats officiels : [création et relecture des posts publicitaires](https://docs.x.com/x-ads-api/creatives/reference), [gestion des campagnes](https://docs.x.com/x-ads-api/campaign-management/reference), [fuseaux et dates](https://docs.x.com/x-ads-api/fundamentals/timezones).
