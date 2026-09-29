# LinkedIn Ads — préflight Development (API 202609)

État constaté le 30 septembre 2026 : l’application dispose du **Development Tier** de l’Advertising API et le compte annonceur iNrCy `558357276` a été ajouté avec succès dans `Products > Advertising API > View Ad Accounts`. Le compte apparaît encore **On hold** dans Campaign Manager ; sa devise, sa facturation et son aptitude à diffuser doivent être relues par l’API avant toute mutation.

## Prérequis externe restant

1. Déployer `LINKEDIN_ADS_DEVELOPMENT_ACCOUNT_IDS=558357276`, strictement aligné sur le compte réellement mappé dans le portail. Cette allowlist locale est un garde-fou fail-closed ; la capture datée de `View Ad Accounts` reste la preuve fournisseur.
2. Reconnecter LinkedIn Ads avec le consentement gestion complet : `rw_ads r_ads_reporting r_organization_admin w_organization_social`. `r_organization_social`, `w_member_social` et `rw_organization_admin` restent exclus. Le diagnostic lecture seule peut toujours utiliser `r_ads` séparément.
3. Relire la devise, la facturation, le statut et les rôles du compte. Tant que Campaign Manager le signale **On hold**, aucune diffusion ne doit être autorisée.

## Contrôle implémenté, sans écriture LinkedIn

`GET /api/ads/linkedin/preflight` relit à chaque passage :

- le compte sélectionné, son rôle, sa devise, son statut et sa capacité de gestion ;
- les groupes de campagnes ;
- les rôles de Page/organisation quand le token possède le scope adéquat ;
- les Bing Geos et les locales prises en charge ;
- l’image LinkedIn et son propriétaire ;
- l’audience, qui doit atteindre au moins 300 membres ;
- les limites de budget et d’enchère retournées par `adBudgetPricing` ;
- les consentements « non politique » et non-discrimination.

Le résultat expose toujours `publicationEnabled: false`. Aucune route de QA n’appelle un `POST`, un `PATCH` ou un `DELETE` LinkedIn.

Limite volontaire du préflight actuel : les géographies sont confirmées à partir du finder `typeahead`, qui peut ne pas renvoyer une URN précédemment choisie. Avant d’activer une mutation, chaque URN devra être relue explicitement avec le finder fournisseur `q=urns`. Jusqu’à cette évolution, un échec de correspondance bloque la préparation au lieu de faire confiance à l’ID client.

## Chaîne de création préparée mais non activée

Les sérialiseurs construisent la séquence officielle et non diffusée : campagne `DRAFT`, dark post avec `feedDistribution: NONE`, creative `DRAFT`, puis creative `ACTIVE` avant que la campagne passe en dernier à `PAUSED` ou `ACTIVE` selon le choix final. Des contrats séparés couvrent modification, archivage, suppression conforme au statut (`DELETE` seulement pour `DRAFT`, sinon `PENDING_DELETION`) et statistiques `adAnalytics`. Les requêtes ne sont pas exécutées tant qu’un workflow durable n’a pas été ajouté pour persister une `operationKey` et chaque URN après chaque succès ; en cas de timeout, un POST ne doit jamais être répété aveuglément.

## Vidéo de validation

Aucune nouvelle vidéo n’est nécessaire pour utiliser le **Development Tier déjà approuvé**. LinkedIn demande une démonstration vidéo lors d’une future demande de passage au **Standard Tier**, qui augmente notamment le nombre de comptes publicitaires gérables.

Références officielles :

- https://learn.microsoft.com/en-us/linkedin/marketing/quick-start?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns?view=li-lms-2026-09
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/audience-counts?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ad-budget-pricing?view=li-lms-2026-09
