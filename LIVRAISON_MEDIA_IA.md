# Livraison iNrCy — génération d’images et de vidéos IA

Cette archive unifie la génération de médias dans une seule modale réutilisable, ouverte depuis le Booster, le menu « Générer un média » et l’éditeur de publications iNrSend. Lors de la recette du 31 août 2026, la migration Supabase Production a été appliquée après sauvegarde, preflight et dry-run transactionnel, puis validée par un postflight intégral. La configuration Vercel existante a également été auditée. Le code applicatif de cette archive n’a pas été déployé en Production par cette intervention.

## Ce qui est livré

- Une seule modale courte en trois étapes : source du sujet (« Idée de la publication », « Profil et activité » ou « Autre sujet »), type de média, puis option (« avec/sans texte » ou « avec/sans musique »).
- Booster : le même bouton « Générer un média » est disponible sous « Votre intention » et dans « Médias de la publication ». Le résultat reste en grand dans la modale et n’est ajouté à la publication qu’après « Utiliser ce média » ; « Régénérer » produit un nouveau média et toute fermeture après génération demande confirmation.
- Le champ idée reste un brief : même en mode « Avec texte », il n’est jamais recopié dans l’image. L’IA compose uniquement une accroche originale courte à partir du sujet et des faits professionnels vérifiés.
- Menu : l’entrée « Générer un média » ouvre directement cette même modale pour toutes les éditions, avec leurs quotas propres.
- iNrSend : l’éditeur d’une publication ouvre également la même modale. La validation insère le média dans le brouillon local ; si un média existe déjà, une confirmation est obligatoire avant son remplacement. Aucune sauvegarde de la publication n’est déclenchée automatiquement.
- Format universel : image JPEG carrée 1024 × 1024 ; vidéo MP4 H.264 carrée 1080 × 1080 de 8 secondes, générée en FLUX 3 full HD non-draft.
- Dix musiques originales iNrCy de 8 secondes avec fondu de sortie, choisies automatiquement selon le sujet et mixées localement avec FFmpeg.
- Après une génération réussie, le média reste un brouillon privé temporaire. Il est enregistré définitivement uniquement après « Utiliser ce média » dans Booster/iNrSend ou « Enregistrer dans la Médiathèque » depuis le menu. Fermer ou régénérer supprime le brouillon, tandis que la génération réussie reste décomptée du quota.
- Quotas mensuels indépendants par établissement :

  | Édition | Images | Vidéos | Atelier avancé |
  | --- | ---: | ---: | --- |
  | Standard | 20 | 5 | Oui |
  | Premium | 30 | 10 | Oui |
  | Founder | 150 | 12 | Oui |

Trois établissements Standard ont donc chacun 20 images et 5 vidéos, soit 60 images et 15 vidéos cumulées. Les compteurs, jobs, dépenses Gateway et médias restent isolés par `account_id`.

## Maîtrise des coûts et de la fiabilité

- Vercel AI Gateway est l’unique transport de génération média.
- Une génération produit exactement un média ; aucun retry fournisseur automatique n’est lancé.
- La musique est ajoutée depuis les assets iNrCy et ne déclenche aucun second appel vidéo.
- Le débit est réservé atomiquement, consommé seulement après l’enregistrement du média et libéré sur échec avant persistance.
- Un retry navigateur incertain réutilise le même `requestId` pour éviter une seconde génération payante.
- Le garde-fou économique existant réserve aussi un coût explicite par établissement pour l’image et la vidéo.
- Le garde vidéo réserve 1,50 USD par clip de 8 secondes (coût de référence 1,36 USD à 0,17 USD/s). Le plafond de sécurité quotidien par défaut est de 20 USD afin de ne pas contredire le quota Premium ; une variable Vercel existante `AI_GATEWAY_MAX_COST_MICRO_USD_PER_ACCOUNT_DAY` doit être au moins égale à `20000000`.

## Mise en production

1. Lire le runbook complet : `docs/AI_MEDIA_GENERATION_ROLLOUT_2026-08-31.md`.
2. Sur une base neuve, appliquer en staging la first-run `ops/sql/2026-08-31_ai_media_generation_quota.sql`, puis son postflight historique. Sur une base où elle est déjà installée, ne jamais la rejouer.
3. Dans les deux cas, appliquer ensuite `ops/sql/2026-08-31_ai_media_generation_studio_all_plans.sql`, puis exécuter `ops/sql/2026-08-31_ai_media_generation_studio_all_plans_postflight_read_only.sql` et exiger `PASS`.
4. Appliquer la migration additive de plafonds `ops/sql/2026-08-31_ai_media_generation_quota_limits_20_5_30_10.sql`, puis exécuter son postflight `ops/sql/2026-08-31_ai_media_generation_quota_limits_20_5_30_10_postflight_read_only.sql` et exiger `PASS`. Ne jamais modifier ni rejouer la migration first-run historique.
5. Appliquer ensuite `ops/sql/2026-08-31_ai_media_generation_temporary_drafts.sql`, puis exécuter `ops/sql/2026-08-31_ai_media_generation_temporary_drafts_postflight_read_only.sql` et exiger `PASS`. Ce patch installe le cycle brouillon privé → validation ou suppression ainsi que la purge de secours à 24 heures.
6. Vérifier les variables serveur existantes et l’un des moyens d’authentification Gateway : `AI_GATEWAY_API_KEY` ou `VERCEL_OIDC_TOKEN`.
7. Les overrides `AI_GATEWAY_IMAGE_MODEL` et `AI_GATEWAY_VIDEO_MODEL` sont optionnels ; ne pas les créer sans recalibrer formats, coût et délais.
8. Utiliser un plan Vercel avec Fluid Compute compatible avec la durée maximale de 800 secondes de la route vidéo.
9. Déployer d’abord en Preview et réaliser un smoke borné : une image sans texte, puis une vidéo avec musique. Pour les deux, vérifier les trois étapes, le grand aperçu, l’absence d’insertion avant validation, la confirmation de fermeture et l’actualisation visible du quota depuis Booster, le Menu et iNrSend.
10. Vérifier que les deux médias apparaissent uniquement dans la médiathèque du bon établissement et que les deux autres établissements d’un compte QA multicompte n’ont pas été débités.
11. Promouvoir ensuite le même build en Production.

### État contrôlé le 31 août 2026

- Supabase Production : sauvegarde planifiée disponible, preflight `READY`, migration additive exécutée une seule fois et postflight `PASS` sur 37/37 contrôles.
- Le patch SQL séparé et idempotent ouvrant le studio aux trois éditions a été appliqué sur Supabase Production ; son postflight en lecture seule retourne `PASS` sur 4/4 contrôles. Le fichier reste inclus pour les autres environnements et n’est jamais exécuté automatiquement par l’application.
- Le nouveau patch de plafonds 20/5 et 30/10 est inclus dans l’archive mais n’est jamais exécuté automatiquement par l’application : il doit être appliqué et contrôlé manuellement avec son postflight avant le déploiement du code.
- Le patch des brouillons temporaires est lui aussi inclus sans exécution automatique : l’appliquer après le patch de plafonds, puis exiger `PASS` sur son postflight avant de déployer le code.
- Vercel : authentification AI Gateway, KV et service role Supabase présents en Preview et Production ; Fluid Compute actif avec 2 vCPU / 4 Go. Aucun secret n’a été affiché ni remplacé.
- Modèles de référence Gateway vérifiés : `openai/gpt-image-2` et `bfl/flux-3-video` (carré, full HD non-draft, 8 secondes, sans audio fournisseur avant mix iNrCy).
- Les fichiers SQL de preflight et postflight sont inclus à côté de la migration pour les futurs environnements. La migration first-run ne doit pas être rejouée sur la base Production déjà installée.

Le bucket privé protège la médiathèque iNrCy, mais ne remplace pas la politique de conservation du fournisseur IA. La fiche Vercel Gateway de GPT Image 2 doit être revue avant lancement ; le registre iNrCy conserve l’empreinte du prompt compilé, pas son texte intégral.

## Validation locale réalisée sur cette archive

- TypeScript global : réussi.
- ESLint global, puis ciblé sur les derniers fichiers modifiés : réussi sans avertissement.
- 45 tests média IA, quotas, brouillons, interface et confidentialité : réussis.
- 702 tests croisés Dashboard, iNrSend, multicompte et AI Gateway : réussis.
- Traductions : 8 392 références statiques validées dans neuf langues.
- Build Next.js : bundling de production et TypeScript réussis ; la collecte finale des pages nécessite les variables Supabase, volontairement absentes de l’archive sans secrets.
- Fallback des modèles : l’absence d’override utilise `openai/gpt-image-2` ou `bfl/flux-3-video` au lieu de convertir une valeur absente en `"undefined"`.

Les appels payants réels restent volontairement limités au smoke explicite décrit dans le runbook. Les tests automatisés n’appellent jamais la Gateway et ne consomment aucun quota.
