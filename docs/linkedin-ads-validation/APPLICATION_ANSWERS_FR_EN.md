# Réponses proposées pour la demande LinkedIn Ads — FR / EN

Ces textes sont des brouillons. Ils doivent être adaptés aux champs exacts du portail et à la version effectivement démontrée. Supprimer toute phrase décrivant une fonction non encore active.

## Nom du produit / Product name

**FR**

iNrCy — iNr’ADS

**EN**

iNrCy — iNr’ADS

## Résumé du cas d’usage / Use-case summary

**FR**

iNrCy est une plateforme destinée aux professionnels qui centralise la préparation et la gestion de leur visibilité numérique. Dans iNr’ADS, un utilisateur authentifié peut connecter son propre compte LinkedIn Ads par OAuth, sélectionner un compte publicitaire qu’il est autorisé à administrer, préparer une campagne LinkedIn spécifique, vérifier les paramètres proposés et, lorsque la fonction de mutation distante sera activée, créer ou modifier cette campagne dans LinkedIn. L’utilisateur garde le contrôle de chaque étape et aucune donnée d’un autre compte n’est accessible.

**EN**

iNrCy is a platform for business users that centralizes the preparation and management of their digital visibility. In iNr’ADS, an authenticated user can connect their own LinkedIn Ads account through OAuth, select an advertising account they are authorized to administer, prepare a LinkedIn-specific campaign, review every proposed setting, and, once the remote mutation feature is enabled, create or edit that campaign on LinkedIn. The user remains in control at every step, and no data from another customer account is accessible.

## Problème résolu / Problem solved

**FR**

Les petites entreprises et leurs prestataires doivent souvent passer d’un outil à l’autre pour structurer une campagne, préparer les textes et visuels, définir une audience puis contrôler le budget. iNrCy simplifie ce travail dans un parcours guidé adapté à LinkedIn, tout en conservant une validation humaine avant toute action distante.

**EN**

Small businesses and their service providers often move between several tools to structure a campaign, prepare copy and media, define an audience, and review budget settings. iNrCy simplifies this work through a guided LinkedIn-specific workflow while retaining human review before any remote action.

## Utilisateurs visés / Intended users

**FR**

Professionnels, responsables marketing et prestataires mandatés qui gèrent leurs propres comptes publicitaires LinkedIn ou ceux pour lesquels ils disposent d’un rôle LinkedIn approprié.

**EN**

Business owners, marketing managers, and authorized service providers who manage their own LinkedIn advertising accounts or accounts for which LinkedIn has granted them an appropriate role.

## Permissions demandées / Requested permissions

**FR**

- `r_ads` pour afficher les comptes publicitaires accessibles au membre et permettre une sélection explicite.
- `rw_ads` seulement lorsque l’utilisateur choisit « Autoriser la gestion », afin de créer ou modifier une campagne sur le compte sélectionné.

iNrCy ne demande pas `r_ads_reporting` dans ce périmètre et ne mélange pas les permissions LinkedIn organiques avec la connexion Ads.

**EN**

- `r_ads` to display advertising accounts accessible to the authenticated member and allow explicit account selection.
- `rw_ads` only after the user selects “Authorize management,” so the application can create or edit a campaign on the selected account.

iNrCy does not request `r_ads_reporting` in this scope and does not mix organic LinkedIn permissions into the Ads connection.

## Contrôle utilisateur / User control

**FR**

L’utilisateur initie lui-même OAuth, choisit le compte, révise chaque paramètre et confirme l’action. Il peut déconnecter LinkedIn Ads depuis iNrCy. Cette déconnexion est séparée de sa connexion LinkedIn organique.

**EN**

The user initiates OAuth, selects the account, reviews every campaign setting, and confirms the action. They can disconnect LinkedIn Ads from iNrCy, independently from their organic LinkedIn connection.

## Sécurité / Security

**FR**

Le Client Secret reste côté serveur. Le flux utilise OAuth 2.0 Authorization Code en 3-legged, un `state` anti-CSRF lié à la session, un callback HTTPS déclaré et l’introspection du jeton. Les jetons sont chiffrés en AES-256-GCM avant stockage. Les comptes et rôles sont relus depuis LinkedIn, et les routes sensibles exigent une session iNrCy autorisée, contrôlent l’origine et appliquent des limites de débit.

**EN**

The Client Secret remains server-side. The integration uses the 3-legged OAuth 2.0 Authorization Code flow, a session-bound anti-CSRF `state`, a registered HTTPS callback, and token introspection. Tokens are encrypted with AES-256-GCM before storage. Account and role data is retrieved from LinkedIn, and sensitive routes require an authorized iNrCy session, validate request origin, and apply rate limits.

## Données et conservation / Data and retention

**FR**

iNrCy conserve uniquement les données nécessaires à la connexion et à la gestion demandée : jetons chiffrés, scopes, identifiant et libellé du compte sélectionné, rôle et indicateurs techniques de vérification. La déconnexion supprime la connexion Ads locale. Les durées de conservation opérationnelles doivent rester conformes aux LinkedIn Marketing API Program Data Storage Requirements et aux demandes de suppression de l’utilisateur. iNrCy n’utilise pas de données de membre LinkedIn pour enrichir un CRM, créer des prospects ou construire une audience.

**EN**

iNrCy stores only the data required for the requested connection and management workflow: encrypted tokens, granted scopes, selected account ID and label, role, and technical verification markers. Disconnecting removes the local Ads connection. Operational retention must remain compliant with the LinkedIn Marketing API Program Data Storage Requirements and user deletion requests. iNrCy does not use LinkedIn member data to enrich a CRM, generate prospects, or build an audience.

## Niveau demandé / Requested tier

### Texte pour Development

**FR**

Nous demandons le niveau Development afin de construire et tester le parcours de bout en bout sur les comptes administrés et explicitement associés à notre application. Nous comprenons que ce niveau limite les modifications à cinq comptes administrés et que les comptes publicitaires réels doivent être créés dans Campaign Manager.

**EN**

We are requesting Development tier access to build and test the end-to-end workflow on advertising accounts administered by the authenticated member and explicitly associated with our application. We understand that this tier limits edits to five administered accounts and that real advertising accounts must be created in Campaign Manager.

### Texte pour Standard — à utiliser après démonstration réelle

**FR**

Après avoir construit et testé l’intégration au niveau Development, nous demandons le niveau Standard pour permettre à nos utilisateurs autorisés de gérer des campagnes sur plusieurs comptes publicitaires. La vidéo jointe démontre une création et une modification réelles effectuées depuis iNrCy, confirmées dans LinkedIn Campaign Manager. La campagne de démonstration reste non diffusée.

**EN**

After building and testing the integration under Development tier, we are requesting Standard tier access so authorized users can manage campaigns across multiple advertising accounts. The attached video demonstrates a real campaign creation and edit initiated from iNrCy and confirmed in LinkedIn Campaign Manager. The demonstration campaign remains non-serving.

## Fonctions non demandées / Out of scope

**FR**

Le périmètre actuel n’inclut pas le reporting publicitaire, la synchronisation des prospects, les Matched Audiences, les Conversions API, l’enrichissement de profils, ni l’export de données de membres.

**EN**

The current scope does not include advertising reporting, lead synchronization, Matched Audiences, the Conversions API, profile enrichment, or export of member data.

## Champs à compléter avant soumission

- `[APP_LINKEDIN_NAME]` — nom exact dans le portail.
- `[APP_LINKEDIN_ID]` — à conserver hors des captures publiques si nécessaire.
- `[COMPANY_PAGE_URL]` — Page vérifiée liée à l’app.
- `[PRODUCTION_URL]` — URL exacte démontrée.
- `[PRIVACY_URL]` — URL publique vérifiée.
- `[DATA_DELETION_URL]` — URL publique vérifiée.
- `[VIDEO_URL]` — lien accessible sans demande d’autorisation.
- `[SUPPORT_EMAIL]` — adresse surveillée pendant la revue.
- `[DEMO_ACCOUNT_INSTRUCTIONS]` — transmis par canal sécurisé, jamais dans Git.
