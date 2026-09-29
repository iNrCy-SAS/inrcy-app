# Réponses proposées au formulaire X Ads API — FR / EN

Ces réponses sont des **brouillons**. Remplacer tous les champs entre crochets par des faits vérifiés avant soumission. Ne jamais inventer un volume, un client ou une capacité de publication.

## 1. Produit et entreprise

### FR

iNrCy est une plateforme SaaS française destinée aux professionnels. Son module iNr’ADS simplifie la préparation et, après autorisation explicite, la gestion de campagnes publicitaires multicanales depuis une interface unique. L’utilisateur garde le contrôle du compte annonceur, du budget, du calendrier et du statut de lancement.

Site : https://inrcy.com
Application : https://app.inrcy.com
Contact technique : [ADRESSE À RENSEIGNER]
App ID X : [APP ID À RENSEIGNER]

### EN

iNrCy is a French SaaS platform for professionals. Its iNr’ADS module simplifies the preparation and, after explicit authorization, management of multi-channel advertising campaigns from a single interface. The advertiser remains in control of the ad account, budget, schedule, and launch status.

Website: https://inrcy.com
Application: https://app.inrcy.com
Technical contact: [TO BE COMPLETED]
X App ID: [TO BE COMPLETED]

## 2. Cas d’usage X Ads

### FR

Un utilisateur iNrCy authentifié choisit X Ads, autorise l’App par le flux OAuth 1.0a de X, consulte uniquement les comptes annonceurs auxquels son compte X a accès, puis sélectionne explicitement le compte à associer. iNrCy vérifie le statut du compte, le rôle de gestion et la disponibilité d’un financement compatible. La première version activée est en lecture seule : elle ne crée ni n’active de campagne distante. Les futures mutations seront testées dans le sandbox, limitées à `PAUSED`, auditées et activées par un feature flag serveur après approbation.

### EN

An authenticated iNrCy user selects X Ads, authorizes the App through X’s OAuth 1.0a flow, views only the advertising accounts their X user can access, and explicitly selects the account to associate. iNrCy verifies the account status, management role, and compatible funding availability. The first enabled version is read-only: it neither creates nor activates a remote campaign. Future mutations will be tested in the sandbox, restricted to `PAUSED`, audited, and enabled through a server-side feature flag after approval.

## 3. Pourquoi Standard Access

### FR

Nous demandons Standard Access car le produit a vocation à gérer des campagnes pour les annonceurs qui autorisent iNrCy. Ce niveau couvre Campaign Management, Creatives, Analytics, Custom Audiences et Conversions. Nous n’utiliserons que les endpoints nécessaires aux fonctionnalités réellement disponibles et démontrées. Conversion Only ne couvre pas ce cas d’usage.

### EN

We request Standard Access because the product is intended to manage campaigns for advertisers who authorize iNrCy. This tier covers Campaign Management, Creatives, Analytics, Custom Audiences, and Conversions. We will only use endpoints required by features that are actually available and demonstrated. Conversion Only does not cover this use case.

## 4. Utilisateurs et volumes

### FR

Public visé : TPE, PME, indépendants et agences gérant leurs propres comptes ou des comptes pour lesquels ils disposent d’un mandat.
Utilisateurs X Ads prévus à 3 mois : [NOMBRE RÉEL].
Comptes annonceurs prévus à 3 mois : [NOMBRE RÉEL].
Appels quotidiens estimés : [ESTIMATION DOCUMENTÉE].
Zones principales : France et [AUTRES ZONES RÉELLES].

### EN

Target users: small businesses, independent professionals, and agencies managing their own accounts or accounts they are authorized to manage.
Expected X Ads users within 3 months: [ACTUAL NUMBER].
Expected ad accounts within 3 months: [ACTUAL NUMBER].
Estimated daily API calls: [DOCUMENTED ESTIMATE].
Primary regions: France and [OTHER ACTUAL REGIONS].

## 5. Données lues et stockées

### FR

iNrCy lit l’identifiant et le nom du compte annonceur, son statut, le rôle du membre authentifié, ainsi que la devise et l’état de financement nécessaires à l’éligibilité. Nous stockons le compte choisi et les jetons OAuth 1.0a chiffrés. Nous ne demandons jamais le mot de passe X, ne lisons pas les messages privés et ne revendons pas les données X.

### EN

iNrCy reads the ad account identifier and name, account status, authenticated member’s role, and the funding currency and readiness required for eligibility. We store the selected account and encrypted OAuth 1.0a tokens. We never request X passwords, do not read private messages, and do not resell X data.

## 6. Sécurité

### FR

Tous les appels Ads utilisent HTTPS et des signatures OAuth 1.0a côté serveur. Les secrets ne sont jamais exposés au navigateur. L’état OAuth est lié à la session iNrCy et à l’organisation active, le request token temporaire est conservé dans un cookie chiffré HttpOnly, et les jetons permanents sont chiffrés avant stockage. Les POST locaux vérifient l’origine et l’autorisation. Une erreur 401 marque la connexion à réautoriser.

### EN

All Ads calls use HTTPS and server-side OAuth 1.0a signatures. Secrets are never exposed to the browser. OAuth state is bound to the iNrCy session and active organization, the temporary request token is kept in an encrypted HttpOnly cookie, and permanent tokens are encrypted before storage. Local POST requests validate origin and authorization. A 401 response marks the connection for reauthorization.

## 7. Suppression et révocation

### FR

L’utilisateur peut déconnecter X Ads dans iNrCy sans affecter sa connexion X organique. Cette action supprime l’intégration Ads locale, ses jetons chiffrés et la sélection du compte. Les demandes de suppression de compte iNrCy couvrent aussi les données d’intégration associées. L’utilisateur peut également révoquer l’App depuis X.

### EN

The user can disconnect X Ads in iNrCy without affecting their organic X connection. This removes the local Ads integration, encrypted tokens, and selected account. iNrCy account deletion requests also cover related integration data. The user may also revoke the App from X.

## 8. Modèle commercial et usage des données

### FR

iNrCy facture l’accès à ses fonctionnalités SaaS. Les données X ne sont ni vendues, ni louées, ni utilisées pour établir des profils hors de la finalité publicitaire demandée par le client. Les dépenses publicitaires sont gérées directement par le compte annonceur et son instrument de financement X.

### EN

iNrCy charges for access to its SaaS features. X data is not sold, rented, or used to build profiles outside the advertising purpose requested by the customer. Advertising spend is handled directly by the advertiser account and its X funding instrument.

## 9. Endpoints initiaux

- `GET https://ads-api.x.com/12/accounts`
- `GET https://ads-api.x.com/12/accounts/:account_id/authenticated_user_access`
- `GET https://ads-api.x.com/12/accounts/:account_id/funding_instruments`

No campaign write endpoint is enabled in the submitted build unless the form is updated with a later, verifiable implementation.
