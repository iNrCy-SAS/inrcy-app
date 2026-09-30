# LinkedIn Ads — dossier de validation iNrCy

État du dossier : **Advertising API Development approuvé**. Constat officiel fourni par l’utilisateur et revérifié en lecture seule dans le portail LinkedIn le **30 septembre 2026** pour l’app dédiée **iNrCy Ads**. La demande Standard n’est ni prête ni soumise.

Ce dossier rassemble les éléments nécessaires pour activer puis faire valider l’intégration LinkedIn Ads d’iNrCy. Il ne contient aucun Client Secret, jeton OAuth, identifiant personnel ni preuve d’approbation qui n’existe pas encore.

## Verdict actuel

| Élément | État | Conséquence |
| --- | --- | --- |
| Connexion OAuth Ads séparée de LinkedIn organique | Implémentée dans le code | Démonstrable après configuration de l’app LinkedIn |
| OAuth Ads principal | Implémenté | `rw_ads r_ads_reporting r_organization_admin w_organization_social` en un consentement ; `r_ads` réservé au diagnostic lecture seule |
| Liste et association d’un compte publicitaire | Implémentées | Le compte et le rôle sont relus depuis LinkedIn |
| Publication Image Ads classique | Implémentée derrière un verrou LinkedIn dédié | Image médiathèque → campagne `DRAFT` → dark post → creative → statut final ; aucun appel live n’a été exécuté pendant la QA |
| Reprise et idempotence | Implémentées | Chaque URN/ID est persisté avant l’étape suivante ; un `POST` à résultat incertain bloque toute répétition aveugle |
| Modification, statut, archivage/suppression et statistiques | Implémentation serveur et tests en finalisation | Chaque mutation doit relire le compte, le rôle et la propriété distante ; aucune preuve live n’est encore produite |
| App dédiée, callback et permissions | Development et callback confirmés le 30/09/2026 | App **iNrCy Ads** ; vérifier au prochain consentement que les quatre scopes manage sont effectivement accordés |
| Accès Advertising API Development | **Approuvé le 30/09/2026** | Permet maintenant les tests Development sur les comptes ajoutés à l’app |
| Configuration Vercel dédiée | OAuth et allowlist Development `558357276` confirmés en lecture seule | Valeurs secrètes non copiées ; le verrou `INRCY_LINKEDIN_ADS_PUBLISH_ENABLED` reste volontairement séparé des autres canaux |
| Accès Advertising API Standard | Non demandé | Demande séparée seulement après une mutation réelle démontrable |
| Vidéo Standard | Storyboard prêt, non tourné | **Aucune vidéo n’est requise pour conserver le Development Tier déjà approuvé** |

Le code possède maintenant un publisher réel, mais il reste **fail-closed** tant que la migration Supabase n’est pas appliquée et que `INRCY_LINKEDIN_ADS_PUBLISH_ENABLED=true` n’est pas configuré dans l’environnement visé. Le compte `558357276` étant encore signalé **On hold**, un lancement `ACTIVE` est refusé. Le chemin `PAUSED` peut servir au test Development sans diffusion après déploiement, migration et contrôle humain. Aucun appel LinkedIn de mutation n’a été réalisé par la QA automatisée.

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
5. Appliquer la migration Supabase, déployer le code et activer uniquement le verrou LinkedIn dans l’environnement choisi.
6. Effectuer avec validation humaine un smoke test Development en `PAUSED`, puis vérifier les IDs et le statut dans Campaign Manager. Ne jamais choisir `ACTIVE` tant que le compte est On hold ou que le groupe parent n’est pas `ACTIVE`.
7. Enregistrer la vidéo **uniquement pour la demande Standard** avec les preuves décrites dans ce dossier.
8. Faire une relecture humaine du texte, de la politique de confidentialité, des captures et des identifiants masqués.
9. Soumettre la demande Standard manuellement si elle devient nécessaire. Aucune soumission n’est automatisée par ce dossier.

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
