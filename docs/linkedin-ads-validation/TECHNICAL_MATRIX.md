# Matrice technique LinkedIn Ads

Cette matrice décrit le code présent au 29 septembre 2026. Elle distingue ce qui est actif de ce qui est seulement préparé.

## Scopes et consentement

| Mode iNrCy | Scope demandé | Usage | État |
| --- | --- | --- | --- |
| Connexion initiale | `r_ads` | Lire les comptes publicitaires du membre authentifié | Implémenté |
| Autoriser la gestion | `rw_ads` | Gérer et lire les comptes où le membre possède un rôle compatible | Implémenté |
| Reporting | `r_ads_reporting` | Rapports de performance | Non demandé, hors périmètre actuel |
| Organique | `w_member_social`, `w_organization_social`, etc. | Publications LinkedIn du dashboard | Connexion distincte, non demandé par Ads |

La documentation LinkedIn liste plusieurs permissions accessibles via le produit Advertising API, mais une app ne doit demander que celles nécessaires. Le parcours iNrCy demande `r_ads` ou `rw_ads` séparément, jamais tout le catalogue Advertising API.

LinkedIn documente `rw_ads` pour certains rôles, dont `CREATIVE_MANAGER`. Par prudence, la politique iNrCy n’autorise la gestion de campagne qu’avec `CAMPAIGN_MANAGER`, `ACCOUNT_MANAGER` ou `ACCOUNT_BILLING_ADMIN`. `VIEWER` et `CREATIVE_MANAGER` restent non gestionnaires dans ce connecteur.

## Routes iNrCy

| Méthode et route | Fonction | Contrôles principaux | Mutation LinkedIn ? |
| --- | --- | --- | --- |
| `GET /api/ads/linkedin/start?access=read` | Démarre OAuth Ads en lecture | Premium/pilote, configuration, callback HTTPS, state signé et cookie HttpOnly | Non |
| `GET /api/ads/linkedin/start?access=manage` | Démarre OAuth Ads en gestion | Mêmes contrôles, scope `rw_ads` explicite | Non |
| `GET /api/ads/linkedin/callback` | Vérifie le callback et stocke la connexion | Session, compte iNrCy lié au state, anti-CSRF, rate limit utilisateur/IP, introspection | Échange de jeton seulement |
| `GET /api/ads/linkedin/status` | Retourne état, scopes et sélection | Pas de cache, fraîcheur du jeton, besoin de reconnexion | Non |
| `GET /api/ads/linkedin/accounts` | Liste les comptes accessibles | Rate limit, rôle via `adAccountUsers`, détail de chaque compte | Lecture |
| `POST /api/ads/linkedin/accounts` | Associe un compte à iNrCy | Origine, session, format d’ID, appartenance relue côté LinkedIn | Local uniquement |
| `POST /api/ads/linkedin/disconnect` | Supprime la connexion Ads locale | Origine, session, filtre `provider/source/product=linkedin_ads/ads` | Suppression locale |

Il n’existe pas de route `/publish`, `/campaigns` ou équivalent qui envoie une campagne à LinkedIn. Toute matrice de revue doit conserver cette mention tant que `publicationEnabled: false`.

## Appels LinkedIn réalisés

| Appel | Usage | En-têtes/contrat |
| --- | --- | --- |
| `GET https://www.linkedin.com/oauth/v2/authorization` | Consentement 3-legged | `state`, callback exact, scope minimal |
| `POST https://www.linkedin.com/oauth/v2/accessToken` | Échange du code ; refresh uniquement si l’app reçoit réellement un refresh token | Secret serveur, formulaire URL-encoded |
| `POST https://www.linkedin.com/oauth/v2/introspectToken` | Vérifie jeton, type 3L, `client_id` et scopes | Secret serveur |
| `GET https://api.linkedin.com/rest/adAccountUsers?q=authenticatedUser` | Lit les rôles du membre sur ses comptes | Bearer, `Linkedin-Version`, REST.li 2.0 |
| `GET https://api.linkedin.com/rest/adAccounts/{id}` | Relit les détails, statut et servabilité | Bearer, `Linkedin-Version`, REST.li 2.0 |

## Préparation de campagne non branchée

`lib/adsLinkedInPublish.ts` sait sérialiser localement un appel potentiel :

- `POST /rest/adAccounts/{id}/adCampaigns` ;
- objectif `WEBSITE_VISIT` ;
- format `STANDARD_UPDATE` / type `SPONSORED_UPDATES` ;
- enchère CPC manuelle ;
- budget quotidien EUR ;
- géographies et locale vérifiées ;
- statut forcé à `DRAFT`.

Ce module ne fait aucun appel réseau. Il ne crée ni groupe de campagnes, ni creative, ni Sponsored Content, ni conversion. Il exige des preuves LinkedIn fraîches de moins de cinq minutes, mais ces preuves ne sont pas encore collectées par un parcours de publication complet. Son existence ne doit pas être décrite comme une campagne LinkedIn créée.

## Variables d’environnement

| Variable | Obligatoire | Secret | Valeur/contrainte |
| --- | --- | --- | --- |
| `LINKEDIN_ADS_CLIENT_ID` | Oui | Non public par prudence | Identifiant de l’app choisie pour Ads |
| `LINKEDIN_ADS_CLIENT_SECRET` | Oui | **Oui** | Serveur uniquement, jamais `NEXT_PUBLIC_` |
| `LINKEDIN_ADS_REDIRECT_URI` | Oui | Non | `https://app.inrcy.com/api/ads/linkedin/callback` |
| `LINKEDIN_ADS_API_VERSION` | Recommandée | Non | `202609` dans le code actuel |
| `NEXT_PUBLIC_APP_URL` | Oui | Non | `https://app.inrcy.com` en production |
| `INRCY_CREDENTIALS_SECRET` | Oui | **Oui** | Base64 décodant exactement 32 octets |

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

## Contrôles reproductibles

```bash
npm run verify:linkedin-ads-env
npm run test:ads-linkedin
```

Ne jamais inclure la sortie de variables ou les valeurs de jetons dans les preuves de revue.
