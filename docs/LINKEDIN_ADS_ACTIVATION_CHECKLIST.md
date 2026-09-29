# LinkedIn Ads — activation du connecteur iNrCy

État au 30 septembre 2026 : l’app dédiée **iNrCy Ads** a obtenu l’Advertising API **Development Tier**. Le callback exact et les scopes Advertising ont été confirmés dans LinkedIn Developers. Cette checklist prépare maintenant le test réel Development sans présenter un brouillon iNrCy comme une campagne LinkedIn créée ou diffusée.

Le dossier de validation complet (readiness, matrice technique, parcours reviewer, vidéo FR/EN, réponses de formulaire, confidentialité et inventaire des preuves) se trouve dans [`docs/linkedin-ads-validation/`](./linkedin-ads-validation/README.md). Cette page reste la checklist technique courte ; le dossier fait foi pour la préparation de la revue.

## Décision d'architecture

LinkedIn n'impose pas techniquement une seconde application : la documentation OAuth permet de sélectionner une app existante puis d'y demander le produit Advertising API. iNrCy sépare néanmoins strictement LinkedIn Ads de LinkedIn organique :

- identifiants serveur explicites `LINKEDIN_ADS_CLIENT_ID` et `LINKEDIN_ADS_CLIENT_SECRET`, sans fallback implicite vers les identifiants organiques ;
- callback dédié `/api/ads/linkedin/callback` ;
- état OAuth dédié `ads_linkedin` ;
- stockage chiffré distinct dans `integrations` avec `provider=linkedin_ads`, `source=linkedin_ads`, `product=ads` ;
- déconnexion Ads qui ne supprime jamais la connexion LinkedIn organique.

Une app LinkedIn dédiée Ads est donc recommandée pour réduire le périmètre des scopes, simplifier la revue et isoler une rotation de secret, mais elle n'est pas une exigence technique annoncée par LinkedIn. Si la même app est volontairement utilisée, renseigner tout de même les variables `LINKEDIN_ADS_*` explicitement.

## État LinkedIn Developers

1. **Confirmé le 30/09/2026** — l’app Ads dédiée est **iNrCy Ads**.
2. **Confirmé le 30/09/2026** — le produit **Advertising API** est au niveau **Development**.
3. **Confirmé le 30/09/2026** — `https://app.inrcy.com/api/ads/linkedin/callback` est enregistré dans les redirect URLs autorisées.
4. **À vérifier au consentement réel** — le parcours principal demande exactement `rw_ads r_ads_reporting r_organization_admin w_organization_social`. Le diagnostic lecture seule reste disponible avec `r_ads`.
5. À faire pour chaque test — ajouter le compte autorisé via **Products > Advertising API > View Ad Accounts**.

Le niveau Development permet de construire le flux de bout en bout : lecture des comptes administrés, édition limitée à cinq comptes administrés et création d'un seul compte test via API ; les comptes réels restent créés dans Campaign Manager. Le niveau Standard retire ces limites pour la gestion multi-comptes. LinkedIn indique que la demande Standard passe par le support et que la démonstration doit montrer la création, la modification ou l'optimisation d'une campagne réelle dans la plateforme. **La vidéo est donc un prérequis du futur Standard Tier, pas du Development Tier déjà approuvé.** Le brouillon local iNrCy ne suffit pas.

## Scopes OAuth minimaux

- `r_ads` : mode diagnostic séparé, lecture et sélection des comptes publicitaires accessibles.
- `rw_ads` : création, modification, pause, activation, archivage et demande de suppression des campagnes autorisées.
- `r_ads_reporting` : consultation des statistiques Ads validées par l’utilisateur.
- `r_organization_admin` : relecture du rôle détenu sur la Page LinkedIn.
- `w_organization_social` : création du Direct Sponsored Content nécessaire à l’annonce image.

Le bouton principal utilise le mode gestion complet en un seul consentement et vérifie chaque scope par introspection. Le mode `r_ads` reste disponible séparément pour le diagnostic. `r_organization_social`, `w_member_social` et `rw_organization_admin` sont exclus. La ligne OAuth Ads, ses identifiants et son callback restent distincts de la connexion LinkedIn organique du dashboard.

Le flux web iNrCy utilise l'Authorization Code Flow avec secret serveur. Il est lié à la session et à l'établissement par un `state` anti-CSRF signé et un cookie HttpOnly à durée courte. LinkedIn documente PKCE pour les clients natifs incapables de conserver un secret ; ce n'est pas le flux de cette application web confidentielle.

## Variables Vercel

```text
LINKEDIN_ADS_CLIENT_ID
LINKEDIN_ADS_CLIENT_SECRET
LINKEDIN_ADS_REDIRECT_URI=https://app.inrcy.com/api/ads/linkedin/callback
LINKEDIN_ADS_API_VERSION=202609
```

`INRCY_CREDENTIALS_SECRET` doit déjà être présent : les access tokens et refresh tokens sont chiffrés en AES-256-GCM avant stockage. Aucun secret LinkedIn ne doit porter le préfixe `NEXT_PUBLIC_`.

La présence de `LINKEDIN_ADS_CLIENT_ID`, `LINKEDIN_ADS_CLIENT_SECRET` et `LINKEDIN_ADS_REDIRECT_URI` dans le projet Vercel a été confirmée en lecture seule le 30/09/2026 ; aucune valeur n’a été affichée ni copiée. La présence ne garantit pas que chaque environnement cible contient la bonne valeur : le contrôle ci-dessous reste obligatoire avant déploiement.

Avant déploiement :

```bash
npm run verify:linkedin-ads-env
```

## Contrôles serveur déjà en place

- validation stricte du callback et de l'utilisateur Supabase courant ;
- rattachement à l'établissement contenu dans l'état OAuth ;
- limitation de débit du callback et du chargement des comptes ;
- introspection du jeton et validation de son `client_id` ;
- renouvellement uniquement lorsqu'un refresh token Marketing approuvé est réellement fourni ; sinon reconnexion explicite à l'expiration ;
- lecture des rôles via `adAccountUsers?q=authenticatedUser` ;
- relecture des détails de chaque compte avant association ;
- refus d'assimiler `VIEWER` ou `CREATIVE_MANAGER` à un rôle capable de gérer une campagne ;
- refus d'un compte Enterprise appartenant à Talent Solutions ou LinkedIn-on-LinkedIn ;
- distinction entre permission de gestion et compte réellement `RUNNABLE` ;
- mise à jour conditionnelle de l'association pour éviter une course avec une déconnexion/reconnexion ;
- réponses d'état non mises en cache.

## Test d'activation

1. Déployer les variables, sans publier de campagne.
2. Connecter d'abord en lecture et vérifier que les comptes retournés sont ceux du membre connecté.
3. Sélectionner explicitement un compte, recharger la page et vérifier la persistance.
4. Connecter via le mode gestion principal et vérifier les quatre scopes réellement accordés.
5. Vérifier le rôle `CAMPAIGN_MANAGER`, `ACCOUNT_MANAGER` ou `ACCOUNT_BILLING_ADMIN`, le statut `ACTIVE`, le produit `MARKETING_SOLUTIONS` pour un compte Enterprise et la servabilité `RUNNABLE`.
6. Tester la déconnexion Ads et confirmer que LinkedIn organique reste connecté.

## Limite actuelle

Le connecteur OAuth, le statut, la découverte des comptes, la sélection et la déconnexion sont prêts côté code. Les contrats locaux couvrent création `DRAFT`, modification, pause/activation, archivage, suppression conforme au statut et statistiques `adAnalytics`. La publication LinkedIn Ads reste désactivée (`publicationEnabled: false`) : ces requêtes sont sérialisées et testées mais aucune route de production ne les exécute encore.

Le blocage n’est donc plus l’accès Development. Il manque encore la collecte live et atomique du groupe de campagnes, de l’organisation, des géographies/locales, ainsi que la création du creative/Sponsored Content et le suivi des identifiants distants. Tant que ces éléments et leurs reprises sur erreur ne sont pas implémentés, brancher le sérialiseur dans la route réelle risquerait une campagne incomplète ou un doublon. Le choix `Active/Paused` ne sera exposé pour LinkedIn qu’après cette chaîne complète ; aucun appel réel LinkedIn n’est effectué par ce lot.

## Sources officielles

- OAuth 3-legged : https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- PKCE pour clients natifs : https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow-native
- Introspection : https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection
- Produits, scopes et niveaux : https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-03
- Niveaux Advertising API : https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-08
- Quick Start et preuve vidéo Standard : https://learn.microsoft.com/en-us/linkedin/marketing/quick-start?view=li-lms-2026-07
- Utilisateurs et rôles des comptes Ads : https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-account-users
- Comptes Ads et servabilité : https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts
- Versioning Marketing API : https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-06
