# LinkedIn Ads — dossier de validation iNrCy

État du dossier : **Advertising API Development approuvé**. Constat officiel fourni par l’utilisateur et revérifié en lecture seule dans le portail LinkedIn le **30 septembre 2026** pour l’app dédiée **iNrCy Ads**. La demande Standard n’est ni prête ni soumise.

Ce dossier rassemble les éléments nécessaires pour activer puis faire valider l’intégration LinkedIn Ads d’iNrCy. Il ne contient aucun Client Secret, jeton OAuth, identifiant personnel ni preuve d’approbation qui n’existe pas encore.

## Verdict actuel

| Élément | État | Conséquence |
| --- | --- | --- |
| Connexion OAuth Ads séparée de LinkedIn organique | Implémentée dans le code | Démonstrable après configuration de l’app LinkedIn |
| OAuth Ads principal | Implémenté | `rw_ads r_ads_reporting r_organization_admin w_organization_social` en un consentement ; `r_ads` réservé au diagnostic lecture seule |
| Liste et association d’un compte publicitaire | Implémentées | Le compte et le rôle sont relus depuis LinkedIn |
| Sérialisation locale d’une campagne LinkedIn `DRAFT` | Préparée, non envoyée | Ce n’est pas une création de campagne distante |
| Route de création/modification de campagne LinkedIn | **Absente / désactivée** | La vidéo Standard conforme ne peut pas encore être tournée |
| App dédiée, callback et permissions | Development et callback confirmés le 30/09/2026 | App **iNrCy Ads** ; vérifier au prochain consentement que les quatre scopes manage sont effectivement accordés |
| Accès Advertising API Development | **Approuvé le 30/09/2026** | Permet maintenant les tests Development sur les comptes ajoutés à l’app |
| Configuration Vercel dédiée | Présence des trois variables OAuth Ads confirmée en lecture seule | Valeurs non copiées ; contrôle d’environnement encore à exécuter dans chaque cible |
| Accès Advertising API Standard | Non demandé | Demande séparée seulement après une mutation réelle démontrable |
| Vidéo Standard | Storyboard prêt, non tourné | **Aucune vidéo n’est requise pour conserver le Development Tier déjà approuvé** |

Le code retourne actuellement `publicationEnabled: false`. Il ne faut donc pas présenter l’intégration comme capable de publier ou modifier une campagne LinkedIn en production.

Le guide Image Ads générique mentionne aussi `r_organization_social`. Le flux iNrCy actuel est volontairement **create-only** pour le contenu sponsorisé : il prépare uniquement `POST /rest/posts` avec `w_organization_social` et ne fait aucun `GET`, finder ou réutilisation de posts LinkedIn. `r_organization_social` est donc exclu. Toute future fonction de lecture ou de réutilisation de posts devra faire l’objet d’une nouvelle revue de périmètre et de consentement.

## Development ou Standard ?

LinkedIn attribue deux niveaux Advertising API :

- **Development** : construction du parcours de bout en bout, lecture sans limite des comptes administrés, création d’un compte publicitaire de test par API, modifications liées à cinq comptes administrés au maximum ; les comptes réels doivent être créés dans Campaign Manager.
- **Standard** : gestion de campagnes pour plusieurs comptes, lecture des comptes administrés sans limite, création de comptes Ads sans limite et modifications liées aux comptes administrés sans limite de nombre de comptes.

Tous les appels API, même au niveau Development, portent sur des données de production. Il faut utiliser un compte maîtrisé, éviter toute diffusion et conserver la campagne en `DRAFT` ou dans un état non diffusé pendant la démonstration.

Le niveau Standard n’est pas automatique. LinkedIn demande une demande distincte, via le Developer Support Portal, accompagnée d’une vidéo montrant comment la plateforme **crée, modifie ou optimise** des campagnes LinkedIn. Une connexion OAuth, une liste de comptes ou un brouillon uniquement local ne répondent pas seuls à cette exigence. Cette vidéo concerne le futur passage **Development → Standard** ; elle n’était pas nécessaire à l’approbation Development constatée le 30 septembre 2026.

## Ordre recommandé

1. **Terminé** — app dédiée **iNrCy Ads**, produit Advertising API Development et callback exact confirmés dans le portail. Le code demande les quatre scopes manage strictement nécessaires et refuse un consentement incomplet.
2. Contrôler les variables serveur dans chaque environnement sans afficher leurs valeurs, puis exécuter `npm run verify:linkedin-ads-env`.
3. Ajouter dans le portail les comptes autorisés au niveau Development via **Products > Advertising API > View Ad Accounts**.
4. Démontrer OAuth, lecture des comptes, association et déconnexion Ads, sans impacter LinkedIn organique.
5. Brancher le workflow distant durable déjà sérialisé : création `DRAFT`, modification, archivage/suppression conforme au statut et lecture `adAnalytics`, avec persistance des URN et reprise idempotente.
6. Enregistrer la vidéo **uniquement pour la demande Standard** avec les preuves décrites dans ce dossier.
7. Faire une relecture humaine du texte, de la politique de confidentialité, des captures et des identifiants masqués.
8. Soumettre la demande Standard manuellement si elle devient nécessaire. Aucune soumission n’est automatisée par ce dossier.

## Documents du dossier

- [Checklist de préparation](./READINESS_CHECKLIST.md)
- [Matrice technique, scopes, routes et variables](./TECHNICAL_MATRIX.md)
- [Parcours reviewer et plan de test](./REVIEWER_TEST_PLAN.md)
- [Storyboard vidéo français et anglais](./VIDEO_STORYBOARD_FR_EN.md)
- [Réponses de formulaire proposées en français et anglais](./APPLICATION_ANSWERS_FR_EN.md)
- [Confidentialité, sécurité et rétention](./PRIVACY_SECURITY_RETENTION.md)
- [Inventaire des preuves et captures](./EVIDENCE_INVENTORY.md)

## Sources officielles vérifiées

- Accès et permissions : <https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-03>
- Niveaux Advertising API : <https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-08>
- Quick Start et exigence vidéo Standard : <https://learn.microsoft.com/en-us/linkedin/marketing/quick-start?view=li-lms-2026-07>
- FAQ Marketing API : <https://learn.microsoft.com/en-us/linkedin/marketing/lms-faq?view=li-lms-2026-07>
- OAuth 3-legged : <https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow>
- Règles de stockage : <https://learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements?view=li-lms-2026-03>
- Versioning Marketing API : <https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-06>

LinkedIn conserve son pouvoir discrétionnaire d’approuver ou non une application, même lorsque les critères minimaux sont remplis.
