# Storyboard vidéo LinkedIn Ads Standard — FR / EN

Le **Development Tier est déjà approuvé depuis le 30 septembre 2026 sans vidéo à fournir**. LinkedIn demande une vidéo uniquement pour une future demande d’upgrade Advertising API **Standard**, montrant comment la plateforme crée, modifie ou optimise des campagnes LinkedIn. Le script ci-dessous ne doit être tourné qu’après activation d’une mutation distante réelle.

Durée conseillée : 4 à 6 minutes. Format : capture d’écran lisible, une seule prise ou montage sans ellipse masquant les actions importantes, narration ou sous-titres.

## Avant l’enregistrement

- Utiliser l’app de production ou un environnement publiquement accessible identique à la version soumise.
- Fermer les onglets contenant des secrets, e-mails personnels, paiements ou autres comptes clients.
- Préparer un compte LinkedIn et un compte Ads explicitement autorisés.
- Conserver la campagne en `DRAFT` ou dans un état sans diffusion.
- Masquer le Client ID si la politique interne l’exige ; toujours masquer Client Secret, jetons, cookies et identifiants de session.
- Faire un essai complet sans enregistrer afin d’éliminer les erreurs et notifications privées.

## Storyboard français

| Temps | Écran et action | Narration proposée | Preuve attendue |
| --- | --- | --- | --- |
| 00:00 | Page d’accueil iNrCy, domaine visible | « iNrCy aide un professionnel authentifié à préparer et gérer ses propres campagnes publicitaires. » | Produit réel et URL |
| 00:20 | iNr’ADS, choisir LinkedIn Ads | « Le canal LinkedIn Ads est distinct de notre connexion LinkedIn organique. » | Séparation des usages |
| 00:40 | Ouvrir Configurer puis Connecter | « La connexion Ads demande en une fois les autorisations strictement nécessaires aux campagnes, au Sponsored Content et aux statistiques. » | Quatre scopes manage visibles |
| 01:00 | Consentement LinkedIn, puis retour iNrCy | « L’utilisateur accorde lui-même l’autorisation sur le domaine LinkedIn. Le callback et le state sont vérifiés côté serveur. » | Consentement réel et retour |
| 01:25 | Charger puis associer le compte | « iNrCy liste uniquement les comptes administrés par ce membre et vérifie son rôle, le statut et la servabilité. » | Compte réel, données inutiles masquées |
| 01:50 | Vérifier les autorisations | « iNrCy refuse un consentement incomplet et garde cette connexion séparée de LinkedIn organique. » | Scopes introspectés |
| 02:15 | Démarrer une campagne LinkedIn | « Le professionnel choisit l’objectif, l’audience, la création, la destination, le budget et le calendrier. L’IA propose des valeurs, mais l’utilisateur contrôle chaque étape. » | Modales LinkedIn dédiées |
| 02:55 | Écran de validation | « Avant tout envoi, iNrCy affiche le compte, l’organisation, le budget, les dates, la locale et les zones qui seront utilisés. » | Récapitulatif complet |
| 03:20 | Confirmer création `DRAFT` | « Nous créons une campagne non diffusée afin de démontrer le flux sans dépenses. » | Réponse de succès réelle, ID distant |
| 03:45 | Campaign Manager | « Voici la campagne créée par iNrCy dans le compte autorisé, avec le même nom et le statut non diffusé. » | Campagne distante visible |
| 04:10 | Modifier dans iNrCy | « Le professionnel modifie maintenant le budget ou le calendrier et enregistre la modification. » | Mutation réelle |
| 04:35 | Campaign Manager rafraîchi | « La modification apparaît dans LinkedIn Campaign Manager. » | Valeur mise à jour |
| 04:55 | Déconnexion Ads | « L’utilisateur peut déconnecter LinkedIn Ads ; cela ne supprime pas sa connexion LinkedIn organique. » | Contrôle utilisateur |
| 05:15 | Politique de confidentialité et suppression | « La politique explique les données traitées et l’utilisateur peut demander leur suppression. » | URLs publiques |

Si la version soumise crée aussi un creative ou un Sponsored Content, le montrer. Sinon, dire explicitement que la démonstration porte uniquement sur la création et la modification de la campagne prise en charge.

## English storyboard

Version complète du parcours demandé : environ 6 à 8 minutes, 11 étapes examinées, confirmations uniquement à la fin, création LinkedIn réelle en pause, puis statistiques via iNrSend > Campagnes Ads > Stats. Le compte Ads se choisit dans la connexion ; la Page et le groupe de test en pause se choisissent à l’étape Campagne, après génération. Le montant et le mode de budget sont ceux de la nouvelle proposition réellement affichée. Les consignes d’écran sont en français et la narration est en anglais. Une seule variante de reporting doit être lue.

### Préparation — ne pas lire à voix haute
Choisir un nom de démonstration unique, par exemple INRCY-LI-REVIEW-[date]-[heure]. Remplacer ce nom dans le brief avant le tournage.
Utiliser un vrai compte Ads autorisé et une Page pour laquelle le membre possède un rôle approuvé. Préparer avant le tournage un groupe de test LinkedIn connu et déjà en pause. Dans iNrCy, la connexion permet d’associer le compte Ads seulement ; la Page et le groupe se choisissent à l’étape 3 « Campagne », après la génération. Ne pas modifier une campagne de diffusion existante pour cette démonstration.
La création native exige que le compte, le groupe, la Page, les zones, les critères, le média et le budget passent leurs vérifications réelles. Ce texte ne remplace pas ces contrôles.
Au dernier écran, continuer uniquement si la confirmation indique exactement une création « en pause, sans diffusion ni dépense ». Si elle autorise la diffusion ou la facturation, arrêter avant VALIDER.
Ne pas montrer de mots de passe, secrets d’application, jetons, cookies ou informations de paiement. Le consentement OAuth doit être réel ; si la session nécessite une connexion, masquer la saisie du mot de passe.
Les phrases après une création réussie ou un résultat API se prononcent seulement lorsque ce résultat est effectivement visible. Un brouillon local ou une erreur de reporting ne constitue pas cette preuve.

### 01 — ACCUEIL
À l’écran (FR) : partir du dashboard d’accueil iNrCy et montrer l’accès iNrADS.
**English narration:**
Hello, this is iNrCy. I will demonstrate our LinkedIn Ads integration, from authorization and campaign preparation to real creation in a paused state, followed by reporting. I will use an authorized advertising account and Page. No paid delivery will be started during this demonstration.

### 02 — INRADS ET CONNEXION LINKEDIN
À l’écran (FR) : ouvrir iNrADS, sélectionner LinkedIn, puis ouvrir la connexion LinkedIn Ads et lancer la vraie autorisation.
**English narration:**
From the home dashboard, I open iNrADS and select LinkedIn. I now connect the advertising integration. LinkedIn handles the authorization on its own website, and I review the permissions before granting access.

### 03 — AUTORISATION DES QUATRE SCOPES
À l’écran (FR) : montrer le consentement LinkedIn réel ; autoriser les quatre permissions demandées. Ne pas prétendre que l’écran natif affiche nécessairement leurs noms techniques.
**English narration:**
The integration requests four permissions for this workflow.
The rw_ads permission lets iNrCy read and manage advertising campaigns in accounts where the signed-in member has an authorized advertising role.
The r_ads_reporting permission lets iNrCy retrieve performance reports from LinkedIn.
The r_organization_admin permission lets iNrCy find the available Pages and check the member’s approved Page role.
The w_organization_social permission lets iNrCy create the sponsored Page content used by the advertisement.
I grant these permissions and return to iNrCy.

### 04 — ASSOCIATION DU COMPTE ADS
À l’écran (FR) : dans la configuration de connexion, associer le vrai compte publicitaire et vérifier son nom et son ID. La Page et le groupe seront choisis plus tard dans le parcours de création.
**English narration:**
I associate the advertising account shown here. I check its name and identifier to make sure that the integration uses the intended account. The Page and campaign group will be selected later in the campaign configuration. This connection is to a real LinkedIn advertising account.

### 05 — VÉRIFICATION NATIVE AVANT CRÉATION
À l’écran (FR) : ouvrir Campaign Manager sur le même compte ; rechercher le nom unique prévu, avec les filtres permettant de voir aussi les éléments en pause. Montrer qu’il n’existe pas encore.
**English narration:**
Before creating anything, I open LinkedIn Campaign Manager and verify the same advertising account. I search for the unique demo name that I will use in iNrCy. There is no matching campaign yet. This gives us a clear before-and-after check.

### 06 — ÉTAPE 1/11 : VOTRE PROJET
À l’écran (FR) : revenir dans iNrADS, choisir le parcours Avec iNrCy et saisir le brief de cette nouvelle démonstration. Ne pas réutiliser l’ancienne campagne ni imposer son budget. Exemple à compléter avec les choix réels :
« Préparer une nouvelle campagne LinkedIn de visites du site https://inrcy.com/, nommée [NOM UNIQUE], avec une image unique et le bouton En savoir plus. Présenter l’offre iNrCy actuellement vérifiée. Zone(s) : [ZONES DE TEST CHOISIES] ; type de localisation : [RÉSIDENCE PERMANENTE OU RÉSIDENCE/PRÉSENCE RÉCENTE] ; audience professionnelle : [CRITÈRES CHOISIS]. Budget : [MONTANT CHOISI] € [AU TOTAL OU PAR JOUR, CHOISIR UN SEUL MODE] ; début [DATE/HEURE FUTURE], fin [DATE/HEURE FUTURE], fuseau [FUSEAU VÉRIFIÉ]. Utiliser le compte Ads déjà associé. La Page autorisée et le groupe de test en pause seront vérifiés à l’étape Campagne. »
**English narration:**
Back in iNrADS, I choose the AI-assisted workflow. In the first step, Your project, I describe the website-visits objective, the intended audience, the single-image advertisement, the destination and the chosen budget. I also provide the campaign name and schedule. These instructions are a proposal for review, not an authorization to spend.

### 07 — ÉTAPE 2/11 : ANALYSE INR CY
À l’écran (FR) : lancer l’analyse ; montrer son attente, puis la proposition réellement reçue. Après le récapitulatif automatique, parcourir les étapes avec le bandeau.
**English narration:**
The second step is the iNrCy analysis. The application prepares a campaign proposal from my brief and business context. I wait for the result, then inspect every configuration step. AI assistance does not replace the advertiser’s review or the checks against LinkedIn’s available resources.

### 08 — ÉTAPE 3/11 : CAMPAGNE
À l’écran (FR) : après génération, ouvrir Campagne ; contrôler le nom unique, l’objectif Visites du site et le compte déjà associé. Choisir ici la « Page qui signe vos annonces », montrer son rôle approuvé, puis « Changer de groupe » et sélectionner le groupe de test existant dont le statut est PAUSED. Ne pas conserver un groupe ACTIVE pour cette démonstration sans dépenses.
**English narration:**
The third step is Campaign. I check the unique name, website-visits objective and associated account. Here I select the authorized Page and the existing paused test group. I verify the Page’s approved role, which supports creating sponsored content for this Page. These selections are real LinkedIn resources.

### 09 — ÉTAPE 4/11 : ZONES GÉOGRAPHIQUES
À l’écran (FR) : montrer les zones de cette nouvelle proposition résolues par LinkedIn et vérifier le type de localisation effectivement sélectionné. Ne dire « Résidence permanente » que si ce réglage est réellement choisi ; sinon montrer « Résidence ou présence récente ».
**English narration:**
The fourth step is Geographic locations. I verify the requested locations and the actual location-type setting: permanent residence or residence and recent presence. The geographic selections come from LinkedIn’s targeting resources. I check that the proposal uses the intended locations rather than unrelated ones from the business profile.

### 10 — ÉTAPE 5/11 : AUDIENCE
À l’écran (FR) : montrer les critères professionnels natifs réellement retenus pour ce brief ; examiner les inclusions, exclusions, éventuelles tailles d’entreprise et l’estimation si affichée.
**English narration:**
The fifth step is Audience. I review the selected professional criteria, their inclusions and exclusions, and any company-size filters. I check that these settings match the brief. Any audience estimate shown is an estimate from the platform, not a promise of impressions or results.

### 11 — ÉTAPE 6/11 : FORMAT
À l’écran (FR) : ouvrir Format ; vérifier Image unique avec l’objectif compatible Visites du site.
**English narration:**
The sixth step is Format. For this demonstration, I use a single-image Sponsored Content advertisement with the website-visits objective. I check the format before reviewing the text and image that will be submitted.

### 12 — ÉTAPE 7/11 : ANNONCE
À l’écran (FR) : ouvrir Annonce ; montrer texte, titre, appel à l’action et aperçu. Vérifier les conditions de l’offre. La narration « twenty-one-day free trial » ne convient que si cette offre est effectivement préparée et vérifiée ; sinon lire « The message presents the offer shown here. » Ne pas affirmer « sans carte bancaire » sans preuve.
**English narration:**
The seventh step is Advertisement. I review the introductory text, headline and Learn more call to action. The message presents iNrCy’s twenty-one-day free trial. I check that the offer and its conditions match the actual product, rather than accepting an unreviewed AI claim.

### 13 — ÉTAPE 8/11 : MÉDIA
À l’écran (FR) : ouvrir Média ; montrer l’image réellement attachée et son aperçu, sans prétendre qu’une génération échouée est terminée.
**English narration:**
The eighth step is Media. I inspect the actual image attached to this advertisement. I check its appearance and the preview with the selected Page and copy. This is the media that will be sent to LinkedIn, not a placeholder in the proposal.

### 14 — ÉTAPE 9/11 : DIFFUSION ET SUIVI
À l’écran (FR) : ouvrir Diffusion et suivi ; vérifier URL réelle, paramètres de suivi, Audience Network, extension d’audience et conversions existantes associées s’il y en a. La stratégie d’enchères se vérifie à l’étape suivante Budget et calendrier.
**English narration:**
The ninth step is Delivery and tracking. I check the destination URL, any tracking parameters, placements, audience expansion and any selected conversion associations. This campaign is configured for website visits. A website link or tracking parameter alone does not prove that conversion tracking has been installed.

### 15 — ÉTAPE 10/11 : BUDGET ET CALENDRIER
À l’écran (FR) : ouvrir Budget et calendrier ; montrer le montant réellement affiché et vérifier explicitement son mode « Budget total sur la période » OU « Budget quotidien moyen ». Montrer les dates exactes, le fuseau, la « Stratégie d’enchères » et le montant si manuel/coût cible. Vérifier les bornes retournées par LinkedIn. Aucun montant fixe n’est imposé par ce script.
**English narration:**
The tenth step is Budget and schedule. I check the displayed amount and explicitly verify whether it is a total budget or an average daily budget. I review the start and end times, timezone and bidding strategy, including its amount when required. The paused state prevents delivery.

### 16 — ÉTAPE 11/11 : VÉRIFIER ET LANCER
À l’écran (FR) : ouvrir la dernière étape ; relire le récapitulatif. Cocher ici seulement le lien, la déclaration non politique, l’avis contre la discrimination et la confirmation « en pause, sans diffusion ni dépense ». Si le texte autorise une dépense, NE PAS cliquer VALIDER.
**English narration:**
The eleventh and final step is Review and create. I verify the complete proposal before confirming the destination, the non-political declaration and LinkedIn’s anti-discrimination notice. All confirmations are made here, on the final screen. I also confirm the displayed creation in a paused state, without delivery or advertising spend. If this screen authorized spending instead, I would stop before proceeding.

### 17 — CRÉATION NATIVE RÉELLE EN PAUSE
À l’écran (FR) : cliquer VALIDER uniquement après tous les contrôles ; montrer la vérification, la création réelle et sa réponse. Ne pas utiliser « Enregistrer en brouillon » comme preuve de publication native.
**English narration:**
I now validate the reviewed configuration. iNrCy rechecks the account, selected resources and permissions before submitting the campaign and advertisement to LinkedIn. I wait for the actual response. The result shown here is a LinkedIn campaign created in pause, not merely a draft saved in the application.

### 18 — APPARITION DANS CAMPAIGN MANAGER ET CONTENU SPONSORISÉ
À l’écran (FR) : revenir à Campaign Manager, actualiser et rechercher le même nom sur le même compte. Selon l’interface LinkedIn, ouvrir campagne/ensemble de publicités puis annonce. Montrer nom, ID, statut En pause et aperçu sponsorisé avec Page, texte, image et URL ; ne pas activer ni reprendre.
**English narration:**
I return to LinkedIn Campaign Manager, refresh the view and search for the same unique name. The newly created campaign is now present in the same account, with its native identifier and paused status. I open its advertisement and verify the sponsored Page identity, copy, image and destination. The native record confirms the creation. I leave it paused and do not activate delivery.

### 19 — RETOUR DANS L’APPLICATION
À l’écran (FR) : revenir dans iNrCy après la preuve native, puis quitter le parcours iNrADS.
**English narration:**
I return to iNrCy. The application retains the same campaign and its LinkedIn identifiers, so I can find the created campaign again without generating another proposal or creating a duplicate advertisement.

### 20 — INR SEND > CAMPAGNES ADS
À l’écran (FR) : ouvrir iNrSend, choisir le dossier Campagnes Ads, retrouver le nom unique et ouvrir la même campagne ; montrer Infos campagne et statut.
**English narration:**
I open iNrSend and select the Ads campaigns folder. I find the same unique campaign name and open its details. The campaign information lets me review the saved content and follow the campaign associated with the native LinkedIn record.

### 21 — STATS : LECTURE API SUR 30 JOURS
À l’écran (FR) : ouvrir Stats, montrer « Statistiques · 30 derniers jours », cliquer Actualiser et attendre la réponse. Lire UNIQUEMENT la variante correspondant au résultat réel ; une erreur doit être corrigée avant de présenter ce passage comme réussi.
**English narration:**
I open the Stats tab and refresh the report for the last thirty days. iNrCy requests the performance of this specific LinkedIn campaign using the r_ads_reporting permission. This is a read-only reporting request. The displayed results come from LinkedIn, not from the AI proposal or the configured budget.

VARIANTE A — si « Aucune donnée de diffusion retournée » :
LinkedIn has returned no delivery data for this campaign in the selected period. That is consistent with a newly created paused campaign. The application shows the absence of data rather than inventing impressions, clicks, spending or conversions.

VARIANTE B — si des métriques réelles sont affichées :
Here are the impressions, clicks, spending and conversions actually returned for this campaign, with the reporting source and retrieval time. I show the returned values as they are and do not replace missing data with projected performance.

### 22 — RETOUR À L’ACCUEIL ET FIN
À l’écran (FR) : fermer les détails, revenir au dashboard d’accueil ; garder la campagne native en pause.
**English narration:**
I return to the home dashboard. This completes the workflow: authorization, account and Page selection, review of all eleven steps, real paused creation, verification in Campaign Manager and reporting from iNrSend. The demonstration ends with no paid delivery started. Thank you for reviewing iNrCy.

### Sources officielles — ne pas lire à voix haute
Permissions OAuth : https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-05
Rôles Page et organizationAcls : https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-05
Reporting r_ads_reporting et réponses sans données : https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting?view=li-lms-2026-04
Niveaux Advertising API Development / Standard : https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-03

Note : LinkedIn indique qu’une réponse de reporting vide peut aussi refléter un accès insuffisant aux données demandées. L’absence de données ne prouve donc pas, à elle seule, tous les droits de reporting. Conserver la preuve de l’autorisation et du bon compte ; ne pas présenter une erreur comme une absence de diffusion normale.

## Captures à éviter

- panneau Network ou console contenant des jetons ;
- fichier `.env` ou tableau Vercel Environment Variables ;
- identifiants complets d’un autre client ;
- formulaire Standard rempli avec des fonctions encore absentes ;
- campagne marquée Active ou diffusion facturable pendant la revue ;
- montage qui remplace Campaign Manager par une maquette.

## Critère de publication de la vidéo

La vidéo est prête uniquement si un reviewer externe peut relier sans ambiguïté :

`action dans iNrCy → appel réel → campagne visible dans Campaign Manager → modification visible`.

À défaut, conserver la vidéo en brouillon et ne pas déposer la demande Standard.
