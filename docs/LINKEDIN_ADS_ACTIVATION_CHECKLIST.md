# LinkedIn Ads — activation du connecteur iNrCy

État au 29 septembre 2026. Cette checklist prépare l'accès réel sans présenter un brouillon iNrCy comme une campagne LinkedIn créée ou diffusée.

Le dossier de validation complet (readiness, matrice technique, parcours reviewer, vidéo FR/EN, réponses de formulaire, confidentialité et inventaire des preuves) se trouve dans [`docs/linkedin-ads-validation/`](./linkedin-ads-validation/README.md). Cette page reste la checklist technique courte ; le dossier fait foi pour la préparation de la revue.

## Décision d'architecture

LinkedIn n'impose pas techniquement une seconde application : la documentation OAuth permet de sélectionner une app existante puis d'y demander le produit Advertising API. iNrCy sépare néanmoins strictement LinkedIn Ads de LinkedIn organique :

- identifiants serveur explicites `LINKEDIN_ADS_CLIENT_ID` et `LINKEDIN_ADS_CLIENT_SECRET`, sans fallback implicite vers les identifiants organiques ;
- callback dédié `/api/ads/linkedin/callback` ;
- état OAuth dédié `ads_linkedin` ;
- stockage chiffré distinct dans `integrations` avec `provider=linkedin_ads`, `source=linkedin_ads`, `product=ads` ;
- déconnexion Ads qui ne supprime jamais la connexion LinkedIn organique.

Une app LinkedIn dédiée Ads est donc recommandée pour réduire le périmètre des scopes, simplifier la revue et isoler une rotation de secret, mais elle n'est pas une exigence technique annoncée par LinkedIn. Si la même app est volontairement utilisée, renseigner tout de même les variables `LINKEDIN_ADS_*` explicitement.

## À configurer dans LinkedIn Developers

1. Lier l'app à une Page LinkedIn vérifiée et demander le produit **Advertising API** depuis l'onglet Products.
2. Obtenir au minimum le niveau **Development**.
3. Ajouter exactement `https://app.inrcy.com/api/ads/linkedin/callback` dans les redirect URLs autorisées.
4. Confirmer dans Auth que les permissions Advertising API attendues sont disponibles.
5. Ne créer ni soumettre une seconde app tant que le choix app existante/app dédiée n'a pas été validé côté produit.

Le niveau Development permet de construire le flux de bout en bout : lecture des comptes administrés, édition limitée à cinq comptes administrés et création d'un seul compte test via API ; les comptes réels restent créés dans Campaign Manager. Le niveau Standard retire ces limites pour la gestion multi-comptes. LinkedIn indique que la demande Standard passe par le support et que la démonstration doit montrer la création, la modification ou l'optimisation d'une campagne réelle dans la plateforme. Le brouillon local iNrCy ne suffit pas.

## Scopes OAuth minimaux

- `r_ads` : lecture et sélection des comptes publicitaires accessibles.
- `rw_ads` : gestion et lecture des comptes pour le futur parcours de campagne.

Le code permet les deux modes séparément et vérifie le scope réellement attaché au jeton avec l'introspection LinkedIn. `r_ads_reporting` n'est pas demandé : aucun parcours de reporting LinkedIn Ads n'est livré. Les scopes organiques (`w_member_social`, `w_organization_social`, etc.) restent dans la connexion LinkedIn du dashboard et ne sont pas ajoutés au consentement Ads.

Le flux web iNrCy utilise l'Authorization Code Flow avec secret serveur. Il est lié à la session et à l'établissement par un `state` anti-CSRF signé et un cookie HttpOnly à durée courte. LinkedIn documente PKCE pour les clients natifs incapables de conserver un secret ; ce n'est pas le flux de cette application web confidentielle.

## Variables Vercel

```text
LINKEDIN_ADS_CLIENT_ID
LINKEDIN_ADS_CLIENT_SECRET
LINKEDIN_ADS_REDIRECT_URI=https://app.inrcy.com/api/ads/linkedin/callback
LINKEDIN_ADS_API_VERSION=202609
```

`INRCY_CREDENTIALS_SECRET` doit déjà être présent : les access tokens et refresh tokens sont chiffrés en AES-256-GCM avant stockage. Aucun secret LinkedIn ne doit porter le préfixe `NEXT_PUBLIC_`.

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
4. Reconnecter en mode gestion seulement quand `rw_ads` est disponible et que le test de campagne doit commencer.
5. Vérifier le rôle `CAMPAIGN_MANAGER`, `ACCOUNT_MANAGER` ou `ACCOUNT_BILLING_ADMIN`, le statut `ACTIVE`, le produit `MARKETING_SOLUTIONS` pour un compte Enterprise et la servabilité `RUNNABLE`.
6. Tester la déconnexion Ads et confirmer que LinkedIn organique reste connecté.

## Limite actuelle

Le connecteur OAuth, le statut, la découverte des comptes, la sélection et la déconnexion sont prêts côté code. La publication LinkedIn Ads reste désactivée (`publicationEnabled: false`) : aucune route de production n'envoie encore de campagne, de creative ou de Sponsored Content à LinkedIn. La sérialisation de campagne DRAFT présente dans le dépôt est une préparation locale et n'est pas reliée à une mutation distante. Elle ne doit être activée qu'après accès Development effectif, preuves de rôle/organisation/ciblage à jour et test sur un compte maîtrisé.

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
