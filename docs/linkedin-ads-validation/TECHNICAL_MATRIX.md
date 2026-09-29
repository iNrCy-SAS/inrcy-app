# Matrice technique LinkedIn Ads

Cette matrice décrit le code présent au 30 septembre 2026. Elle distingue ce qui est actif de ce qui est seulement préparé. L’app dédiée **iNrCy Ads** dispose du **Development Tier** et du callback Ads exact. Le Standard Tier n’est pas accordé ni demandé.

## Scopes et consentement

| Mode iNrCy | Scope demandé | Usage | État |
| --- | --- | --- | --- |
| Principal gestion | `rw_ads r_ads_reporting r_organization_admin w_organization_social` | Campagnes, statistiques, rôle Page et Direct Sponsored Content | Implémenté, consentement réel à vérifier |
| Diagnostic lecture | `r_ads` | Lire les comptes publicitaires sans droit de mutation | Implémenté séparément |
| Exclus | `r_organization_social`, `w_member_social`, `rw_organization_admin` | Non nécessaires à ce cas d’usage | Non demandés |

Le bouton principal demande les quatre scopes manage en une fois afin de couvrir les fonctions explicitement demandées sans second consentement. `rw_ads` couvre déjà la lecture Ads ; `r_ads` n’est donc présent que dans le mode diagnostic séparé.

Le guide Image Ads générique cite `r_organization_social`, mais le flux iNrCy actuel ne lit, ne recherche et ne réutilise aucun post. Il prépare seulement la création d’un dark post avec `POST /rest/posts`, couverte par `w_organization_social` dans le catalogue 202609. Toute future lecture, recherche ou réutilisation de posts imposera une nouvelle revue des scopes avant implémentation.

LinkedIn documente `rw_ads` pour certains rôles, dont `CREATIVE_MANAGER`. Par prudence, la politique iNrCy n’autorise la gestion de campagne qu’avec `CAMPAIGN_MANAGER`, `ACCOUNT_MANAGER` ou `ACCOUNT_BILLING_ADMIN`. `VIEWER` et `CREATIVE_MANAGER` restent non gestionnaires dans ce connecteur.

## Routes iNrCy

| Méthode et route | Fonction | Contrôles principaux | Mutation LinkedIn ? |
| --- | --- | --- | --- |
| `GET /api/ads/linkedin/start?access=read` | Démarre OAuth Ads en lecture | Premium/pilote, configuration, callback HTTPS, state signé et cookie HttpOnly | Non |
| `GET /api/ads/linkedin/start` ou `?access=manage` | Démarre OAuth Ads principal | Quatre scopes exacts, state signé, callback dédié | Non |
| `GET /api/ads/linkedin/callback` | Vérifie le callback et stocke la connexion | Session, compte iNrCy lié au state, anti-CSRF, rate limit utilisateur/IP, introspection | Échange de jeton seulement |
| `GET /api/ads/linkedin/status` | Retourne état, scopes et sélection | Pas de cache, fraîcheur du jeton, besoin de reconnexion | Non |
| `GET /api/ads/linkedin/accounts` | Liste les comptes accessibles | Rate limit, rôle via `adAccountUsers`, détail de chaque compte | Lecture |
| `POST /api/ads/linkedin/accounts` | Associe un compte à iNrCy | Origine, session, format d’ID, appartenance relue côté LinkedIn | Local uniquement |
| `POST /api/ads/linkedin/disconnect` | Supprime la connexion Ads locale | Origine, session, filtre `provider/source/product=linkedin_ads/ads` | Suppression locale |
| `GET /api/ads/linkedin/preflight` | Relit les preuves requises avant mutation | Compte Development, groupe, Page, image, Bing Geo, locale, audience et pricing | Lecture uniquement |

Il n’existe pas de route `/publish`, `/campaigns` ou équivalent qui envoie une campagne à LinkedIn. Toute matrice de revue doit conserver cette mention tant que `publicationEnabled: false`.

## Appels LinkedIn réalisés

| Appel | Usage | En-têtes/contrat |
| --- | --- | --- |
| `GET https://www.linkedin.com/oauth/v2/authorization` | Consentement 3-legged | `state`, callback exact, scope minimal |
| `POST https://www.linkedin.com/oauth/v2/accessToken` | Échange du code ; refresh uniquement si l’app reçoit réellement un refresh token | Secret serveur, formulaire URL-encoded |
| `POST https://www.linkedin.com/oauth/v2/introspectToken` | Vérifie jeton, type 3L, `client_id` et scopes | Secret serveur |
| `GET https://api.linkedin.com/rest/adAccountUsers?q=authenticatedUser` | Lit les rôles du membre sur ses comptes | Bearer, `Linkedin-Version`, REST.li 2.0 |
| `GET https://api.linkedin.com/rest/adAccounts/{id}` | Relit les détails, statut et servabilité | Bearer, `Linkedin-Version`, REST.li 2.0 |

La vérification des géographies utilise actuellement les suggestions `adTargetingEntities?q=typeahead`. Elle peut bloquer à tort une URN déjà sélectionnée qui n’apparaît plus dans les suggestions courantes. Avant toute mutation réelle, le workflow devra relire chaque URN sélectionnée avec le finder fournisseur adapté (`q=urns`) ; aucune donnée Bing Maps ne doit être persistée.

## Préparation de campagne non branchée

`lib/adsLinkedInPublish.ts` et `lib/adsLinkedInOperations.ts` sérialisent localement :

- `POST /rest/adAccounts/{id}/adCampaigns` ;
- objectif `WEBSITE_VISIT` ;
- format `STANDARD_UPDATE` / type `SPONSORED_UPDATES` ;
- enchère CPC manuelle ;
- budget quotidien EUR ;
- géographies et locale vérifiées ;
- statut forcé à `DRAFT`, dark post non distribué et creative `DRAFT` ;
- modification et transitions `ACTIVE`/`PAUSED` avec préflight ;
- archivage `ARCHIVED` distinct de la suppression ;
- `DELETE` uniquement pour un `DRAFT`, sinon `PENDING_DELETION` ;
- statistiques `GET /rest/adAnalytics` au pivot `CAMPAIGN`, granularité quotidienne.

Ces modules ne font aucun appel réseau. Ils exigent des preuves LinkedIn fraîches de moins de cinq minutes et des confirmations fortes pour activation, archivage et suppression. Les opérations d’édition, d’activation/pause et d’archivage refusent `COMPLETED`, `CANCELED`, `PENDING_DELETION` et `REMOVED`. La réactivation spécifique d’une campagne `COMPLETED`, qui exigerait aussi son calendrier original et une nouvelle date de fin, n’est pas implémentée. Leur existence ne doit pas être décrite comme une campagne LinkedIn créée ou modifiée tant que le workflow distant reste désactivé.

## Variables d’environnement

| Variable | Obligatoire | Secret | Valeur/contrainte |
| --- | --- | --- | --- |
| `LINKEDIN_ADS_CLIENT_ID` | Oui | Non public par prudence | Identifiant de l’app choisie pour Ads |
| `LINKEDIN_ADS_CLIENT_SECRET` | Oui | **Oui** | Serveur uniquement, jamais `NEXT_PUBLIC_` |
| `LINKEDIN_ADS_REDIRECT_URI` | Oui | Non | `https://app.inrcy.com/api/ads/linkedin/callback` |
| `LINKEDIN_ADS_API_VERSION` | Recommandée | Non | `202609` dans le code actuel |
| `NEXT_PUBLIC_APP_URL` | Oui | Non | `https://app.inrcy.com` en production |
| `INRCY_CREDENTIALS_SECRET` | Oui | **Oui** | Base64 décodant exactement 32 octets |

La présence de `LINKEDIN_ADS_CLIENT_ID`, `LINKEDIN_ADS_CLIENT_SECRET` et `LINKEDIN_ADS_REDIRECT_URI` dans le projet Vercel a été constatée en lecture seule le 30/09/2026, sans afficher leurs valeurs. Ce constat ne remplace pas `npm run verify:linkedin-ads-env` dans chaque environnement visé. La résolution serveur privilégie `NEXT_PUBLIC_APP_URL`, puis `NEXT_PUBLIC_SITE_URL`, et refuse un callback d’un autre origin, une autre route, une query string, un fragment ou du HTTP hors loopback.

La version Marketing API `202609` est active et annoncée avec une échéance de migration au 15 septembre 2027. LinkedIn publie une version chaque mois : cette date doit être revue avant enregistrement et avant soumission.

## Callback, session et stockage

- callback production : `https://app.inrcy.com/api/ads/linkedin/callback` ;
- état OAuth : famille `ads_linkedin`, lié à l’utilisateur Auth, au compte iNrCy actif et au mode `read`/`manage` ;
- cookie state : HttpOnly, SameSite Lax, Secure en HTTPS, durée dix minutes ;
- stockage : ligne distincte `provider=linkedin_ads`, `source=linkedin_ads`, `product=ads` ;
- jetons : chiffrement AES-256-GCM avec IV aléatoire avant persistance ;
- déconnexion : suppression limitée à la ligne LinkedIn Ads ; la connexion organique reste intacte ;
- cache des routes statut/comptes : `Cache-Control: no-store`.

## Critères de compte appliqués par iNrCy

Pour signaler qu’un compte peut gérer une campagne, iNrCy exige :

- le scope `rw_ads` ;
- un rôle `CAMPAIGN_MANAGER`, `ACCOUNT_MANAGER` ou `ACCOUNT_BILLING_ADMIN` ;
- un compte `ACTIVE` ;
- un type `BUSINESS`, ou `ENTERPRISE` avec `productType=MARKETING_SOLUTIONS`.

Pour signaler qu’un compte peut diffuser, iNrCy exige en plus `servingStatuses=[RUNNABLE]` et refuse les comptes marqués `test`. Cette indication reste informative tant que la publication est désactivée.

`LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS` est uniquement un miroir local fail-closed des comptes que l’équipe affirme avoir ajoutés dans **View Ad Accounts**. Sa présence ne constitue jamais une preuve LinkedIn : la capture portail datée reste obligatoire, et la liste est actuellement vide.

## Contrôles reproductibles

```bash
npm run verify:linkedin-ads-env
npm run test:ads-linkedin
```

Ne jamais inclure la sortie de variables ou les valeurs de jetons dans les preuves de revue.

Ces contrôles certifient le contrat du code et de la configuration, pas le niveau fournisseur. Le niveau Development est attesté séparément par LIADS-02/LIADS-44. La vidéo du storyboard ne concerne qu’une future demande Standard après mutation distante réelle.
