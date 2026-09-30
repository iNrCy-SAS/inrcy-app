# LinkedIn Ads — préflight Development (API 202609)

État constaté le 30 septembre 2026 : l’application dispose du **Development Tier** de l’Advertising API et le compte annonceur iNrCy `558357276` a été ajouté avec succès dans `Products > Advertising API > View Ad Accounts`. Le compte apparaît encore **On hold** dans Campaign Manager ; sa devise, sa facturation et son aptitude à diffuser doivent être relues par l’API avant toute mutation.

## Prérequis externe restant

1. **Configuré le 30/09/2026** — `LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS=558357276` dans Vercel Production/Preview, strictement aligné sur le compte réellement mappé. Cette allowlist locale reste un garde-fou ; la capture datée de `View Ad Accounts` est la preuve fournisseur.
2. Reconnecter LinkedIn Ads avec le consentement gestion complet : `rw_ads r_ads_reporting r_organization_admin w_organization_social`. `r_organization_social`, `w_member_social` et `rw_organization_admin` restent exclus. Le diagnostic lecture seule peut toujours utiliser `r_ads` séparément.
3. Relire la devise, la facturation, le statut et les rôles du compte. Tant que Campaign Manager le signale **On hold**, aucune diffusion ne doit être autorisée.

## Contrôle de ressources GET-only

`GET /api/ads/linkedin/preflight` relit à chaque passage :

- le compte sélectionné, son rôle, sa devise, son statut et sa capacité de gestion ;
- les groupes de campagnes ;
- les rôles de Page/organisation quand le token possède le scope adéquat ;
- les Bing Geos et les locales prises en charge ;
- l’image LinkedIn et son propriétaire ;
- l’audience, qui doit atteindre au moins 300 membres ;
- les limites de budget et d’enchère retournées par `adBudgetPricing` ;
- les consentements « non politique » et non-discrimination.

Cette route de sélection/préflight reste volontairement GET-only. Le statut global expose séparément le verrou `INRCY_LINKEDIN_ADS_PUBLISH_ENABLED`; les tests QA ne déclenchent jamais de `POST`, `PARTIAL_UPDATE`, `PUT` ou `DELETE` LinkedIn.

Le finder UI peut utiliser `typeahead`, mais le publisher relit avant mutation l’ensemble exact des URN choisies via `q=urns` et vérifie la facette `locations`. Un écart bloque la création au lieu de faire confiance au brouillon client.

## Chaîne de création implémentée, déploiement encore verrouillé

La séquence officielle est branchée : image initialisée/uploadée/confirmée, campagne `DRAFT`, dark post avec `feedDistribution: NONE`, creative `DRAFT` puis `ACTIVE`, et campagne finale `PAUSED` ou `ACTIVE`. Une `operationKey` stable et chaque URN/ID sont persistés dans `provider_resources` avant l’étape suivante. En l’absence de clé d’idempotence LinkedIn documentée, un `POST` à réponse incertaine bloque la reprise automatique. `ACTIVE` exige un compte servable et un groupe parent `ACTIVE`; le compte actuellement On hold ne peut donc être lancé qu’en `PAUSED` après migration, déploiement et confirmation humaine.

## Vidéo de validation

Aucune nouvelle vidéo n’est nécessaire pour utiliser le **Development Tier déjà approuvé**. LinkedIn demande une démonstration vidéo lors d’une future demande de passage au **Standard Tier**, qui augmente notamment le nombre de comptes publicitaires gérables.

Références officielles :

- https://learn.microsoft.com/en-us/linkedin/marketing/quick-start?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/audience-counts?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ad-budget-pricing?view=li-lms-2026-09
