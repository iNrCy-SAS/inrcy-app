# Storyboard vidéo LinkedIn Ads — FR / EN

LinkedIn demande une vidéo pour l’upgrade Advertising API Standard montrant comment la plateforme crée, modifie ou optimise des campagnes LinkedIn. Le script ci-dessous ne doit être tourné qu’après activation d’une mutation distante réelle.

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
| 00:40 | Ouvrir Configurer puis Connecter | « La connexion initiale demande uniquement la lecture des comptes publicitaires. » | Départ OAuth `r_ads` |
| 01:00 | Consentement LinkedIn, puis retour iNrCy | « L’utilisateur accorde lui-même l’autorisation sur le domaine LinkedIn. Le callback et le state sont vérifiés côté serveur. » | Consentement réel et retour |
| 01:25 | Charger puis associer le compte | « iNrCy liste uniquement les comptes administrés par ce membre et vérifie son rôle, le statut et la servabilité. » | Compte réel, données inutiles masquées |
| 01:50 | Autoriser la gestion | « La permission de gestion `rw_ads` fait l’objet d’un consentement distinct. » | Upgrade explicite |
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

| Time | Screen and action | Suggested narration | Expected evidence |
| --- | --- | --- | --- |
| 00:00 | iNrCy home, domain visible | “iNrCy helps authenticated business users prepare and manage their own advertising campaigns.” | Real product and URL |
| 00:20 | iNr’ADS, select LinkedIn Ads | “LinkedIn Ads is separated from our organic LinkedIn connection.” | Use-case separation |
| 00:40 | Open Configure and Connect | “The initial connection requests only permission to read the member’s advertising accounts.” | `r_ads` OAuth start |
| 01:00 | LinkedIn consent, then return | “The member grants access on LinkedIn. iNrCy validates the callback and state on the server.” | Real consent and callback |
| 01:25 | Load and associate an account | “iNrCy lists only accounts administered by this member and rechecks role, status, and serving eligibility.” | Real authorized account |
| 01:50 | Authorize management | “The `rw_ads` management permission requires a separate explicit authorization.” | Explicit scope upgrade |
| 02:15 | Start a LinkedIn campaign | “The business user reviews the objective, audience, creative, destination, budget, and schedule. AI may propose values, but the user controls every step.” | LinkedIn-specific flow |
| 02:55 | Final review | “Before any API mutation, iNrCy displays the selected account, organization, budget, dates, locale, and locations.” | Complete review |
| 03:20 | Confirm `DRAFT` creation | “We create a non-serving campaign to demonstrate the workflow without incurring spend.” | Real success and remote ID |
| 03:45 | Campaign Manager | “This is the campaign created by iNrCy in the authorized account, with the same name and a non-serving status.” | Remote campaign visible |
| 04:10 | Edit in iNrCy | “The business user now changes the budget or schedule and saves the update.” | Real mutation |
| 04:35 | Refresh Campaign Manager | “The update is now visible in LinkedIn Campaign Manager.” | Updated value |
| 04:55 | Disconnect Ads | “The user can disconnect LinkedIn Ads without removing their separate organic LinkedIn connection.” | User control |
| 05:15 | Privacy and deletion pages | “Our privacy notice describes the processed data, and users can request deletion.” | Public URLs |

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
