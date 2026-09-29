# LinkedIn Ads — dossier de validation iNrCy

État du dossier : **préparé, non soumis**. Dernière vérification documentaire : 29 septembre 2026.

Ce dossier rassemble les éléments nécessaires pour activer puis faire valider l’intégration LinkedIn Ads d’iNrCy. Il ne contient aucun Client Secret, jeton OAuth, identifiant personnel ni preuve d’approbation qui n’existe pas encore.

## Verdict actuel

| Élément | État | Conséquence |
| --- | --- | --- |
| Connexion OAuth Ads séparée de LinkedIn organique | Implémentée dans le code | Démonstrable après configuration de l’app LinkedIn |
| Scopes minimaux `r_ads` puis `rw_ads` | Implémentés | Le consentement de gestion est demandé explicitement |
| Liste et association d’un compte publicitaire | Implémentées | Le compte et le rôle sont relus depuis LinkedIn |
| Sérialisation locale d’une campagne LinkedIn `DRAFT` | Préparée, non envoyée | Ce n’est pas une création de campagne distante |
| Route de création/modification de campagne LinkedIn | **Absente / désactivée** | La vidéo Standard conforme ne peut pas encore être tournée |
| Accès Advertising API Development | À confirmer dans le portail | Aucun accès externe n’est présumé |
| Accès Advertising API Standard | Non demandé dans ce dossier | Demande séparée après test réel |
| Vidéo Standard | Storyboard prêt | À enregistrer seulement quand une mutation réelle fonctionne |

Le code retourne actuellement `publicationEnabled: false`. Il ne faut donc pas présenter l’intégration comme capable de publier ou modifier une campagne LinkedIn en production.

## Development ou Standard ?

LinkedIn attribue deux niveaux Advertising API :

- **Development** : construction du parcours de bout en bout, lecture sans limite des comptes administrés, création d’un compte publicitaire de test par API, modifications liées à cinq comptes administrés au maximum ; les comptes réels doivent être créés dans Campaign Manager.
- **Standard** : gestion de campagnes pour plusieurs comptes, lecture des comptes administrés sans limite, création de comptes Ads sans limite et modifications liées aux comptes administrés sans limite de nombre de comptes.

Tous les appels API, même au niveau Development, portent sur des données de production. Il faut utiliser un compte maîtrisé, éviter toute diffusion et conserver la campagne en `DRAFT` ou dans un état non diffusé pendant la démonstration.

Le niveau Standard n’est pas automatique. LinkedIn demande une demande distincte, via le Developer Support Portal, accompagnée d’une vidéo montrant comment la plateforme **crée, modifie ou optimise** des campagnes LinkedIn. Une connexion OAuth, une liste de comptes ou un brouillon uniquement local ne répondent pas seuls à cette exigence.

## Ordre recommandé

1. Choisir et documenter l’app LinkedIn utilisée pour Ads. iNrCy recommande une app Ads dédiée, même si LinkedIn n’annonce pas cette séparation comme une obligation technique.
2. Demander le produit Advertising API et obtenir le niveau Development.
3. Déclarer le callback exact `https://app.inrcy.com/api/ads/linkedin/callback`.
4. Configurer les variables serveur, puis exécuter `npm run verify:linkedin-ads-env`.
5. Ajouter dans le portail les comptes autorisés au niveau Development via **Products > Advertising API > View Ad Accounts**.
6. Démontrer OAuth, lecture des comptes, association et déconnexion Ads, sans impacter LinkedIn organique.
7. Implémenter et tester une mutation distante réelle, limitée et sûre : création d’une campagne `DRAFT`, puis modification vérifiable dans Campaign Manager.
8. Enregistrer la vidéo Standard avec les preuves décrites dans ce dossier.
9. Faire une relecture humaine du texte, de la politique de confidentialité, des captures et des identifiants masqués.
10. Soumettre la demande Standard manuellement. Aucune soumission n’est automatisée par ce dossier.

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
