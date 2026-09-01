# Génération de médias IA — guide de déploiement du 31 août 2026

> Ce document est un runbook. Sa rédaction et les vérifications locales ne déploient rien dans Supabase, Vercel ou AI Gateway.

## 1. Contrat à préserver

- Toutes les générations d’images et de vidéos passent par **Vercel AI Gateway**. Une clé fournisseur directe ne doit pas servir de repli pour ce flux.
- Le quota appartient à l’**établissement actif** (`account_id`), jamais au seul utilisateur AUTH ni à un compteur commun au bundle multicompte.
- Chaque établissement possède son propre compteur. Trois établissements couverts par l’édition Standard disposent donc chacun de 20 images et 5 vidéos par mois, soit 60 images et 15 vidéos au total.
- L’entitlement commercial peut rester facturé au niveau du propriétaire AUTH ou d’un bundle multicompte. Le code doit néanmoins le résoudre sémantiquement depuis `activeUserId` afin de rester compatible avec une future facturation par établissement.
- Les périodes sont des mois calendaires en UTC. Une réservation en cours réduit immédiatement le solde disponible ; elle devient une consommation uniquement à la réussite.
- Booster et l’atelier avancé « Générer un média » sont accessibles à toutes les éditions. Les deux surfaces partagent le quota mensuel de l’établissement actif.
- Booster impose une revue explicite du résultat : grand aperçu image ou vidéo, quota visible, puis « Utiliser ce média » ou « Régénérer ». Une génération réussie consomme son unité, mais reste un brouillon privé temporaire tant que le pro ne la valide pas. Fermer ou régénérer demande confirmation et supprime le brouillon ; le quota consommé n’est pas recrédité.
- Le texte libre de l’idée est traité comme un brief confidentiel et ne doit jamais être recopié dans une image. Le mode « Avec texte » produit seulement une accroche courte originale fondée sur les faits vérifiés.
- Une génération produit un seul média : image carrée 1024 × 1024 ou vidéo carrée HD de 8 secondes.
- Le choix image est « avec texte » ou « sans texte ». Le choix vidéo est « avec musique » ou « sans musique ».
- Le média n’est enregistré définitivement dans la médiathèque qu’après validation : « Utiliser ce média » dans Booster/iNrSend ou « Enregistrer dans la Médiathèque » depuis le menu.
- Les médias restent **privés** : bucket privé, chemin sous `users/{accountId}/…` et consultation par URL signée courte. Ne jamais fabriquer d’URL publique permanente.
- Réutiliser un média déjà présent dans la médiathèque ne lance aucune génération et **ne débite jamais de quota**.
- Rejouer la même requête avec la même clé est idempotent. Demander une nouvelle variante avec une nouvelle clé consomme une nouvelle unité si elle réussit.
- Avant d’expirer une réservation, le ledger recherche le média final `ai-media:{jobId}` dans la médiathèque du même compte. S’il existe déjà et est actif/uploadé, le job est récupéré en `completed` et l’unité est consommée : une panne après upload ne crée jamais de média gratuit.
- Les dix pistes musicales iNrCy sont des assets internes de 8 secondes avec fondu de sortie. Leur ajout ne consomme pas une seconde génération vidéo.

## 2. Plafonds livrés

| Édition de l’établissement | Images / mois | Vidéos / mois | Atelier avancé |
| --- | ---: | ---: | --- |
| Standard | 20 | 5 | Oui |
| Premium | 30 | 10 | Oui |
| Founder | 150 | 12 | Oui |

Ces valeurs sont présentes dans `public.ai_media_plan_limits` et dans le helper serveur. Un éventuel `limitOverride` reste une décision serveur : il ne doit jamais être lu depuis le body client.

## 3. Préflight Supabase

Utiliser d’abord un projet Supabase de Preview ou de staging. Faire un snapshot de la base et relever le dernier identifiant de migration appliqué avant toute écriture.

Le nouveau SQL suppose que l’historique canonique du dépôt a déjà été exécuté, notamment :

- le socle multicompte `2026-07-05_multicompte_step1_foundation.sql` et ses durcissements ultérieurs ;
- la table historique `20260625_pro_media_library.sql` ;
- `2026-07-29_media_pipeline_step2_universal_registry.sql`, qui rattache la médiathèque aux établissements et ajoute `account_id`, `upload_status`, `client_media_key` et `upload_protocol` ;
- le bucket privé `inrcy-pro-media` et les migrations du pipeline média déjà requises par l’application.

Ne pas appliquer ces fichiers à la main dans un ordre inventé sur une base neuve : rejouer l’historique de migrations canonique.

Avant toute écriture, exécuter intégralement le script distinct :

```text
ops/sql/2026-08-31_ai_media_generation_preflight_read_only.sql
```

Il ouvre explicitement une transaction `READ ONLY` et retourne une ligne avec :

- `verdict = READY` si tables, fonctions, rôles, types et colonnes prérequises sont présents et si aucun objet cible n’existe ;
- `verdict = NO-GO`, la liste `failed_prerequisites` et/ou la liste `collisions` dans tous les autres cas.

Le script détecte les relations, fonctions, indexes, triggers, policies et contraintes `ai_media_*`, ainsi que les cinq RPC dont le nom commence par `get_`, `reserve_`, `complete_`, `fail_` ou `expire_`. Archiver son résultat avec le journal de déploiement.

Un `NO-GO` est bloquant. Après une installation réussie, les collisions sont normales et prouvent que cette migration **ne doit jamais être rejouée**. Toute évolution ultérieure exige un nouveau fichier SQL daté ; ne pas modifier ni réexécuter l’installation first-run. La migration possède en plus son propre `DO` fail-closed, exécuté avant le premier `CREATE`, qui redétecte les collisions puis revérifie `auth.users`, `inrcy_touch_updated_at()`, `gen_random_uuid()`/`pgcrypto`, les rôles Supabase et toutes les colonnes utilisées.

## 4. Ordre de déploiement

1. Geler les changements de schéma concurrents et sauvegarder la base cible.
2. Exécuter le preflight read-only et exiger le verdict `READY`.
3. Exécuter les tests locaux de la section 7 sur le commit destiné au déploiement.
4. Appliquer en staging, puis en Production seulement après validation, la migration additive :

   ```text
   ops/sql/2026-08-31_ai_media_generation_quota.sql
   ```

5. Exécuter immédiatement le postflight read-only et exiger le verdict `PASS` :

   ```text
   ops/sql/2026-08-31_ai_media_generation_postflight_read_only.sql
   ```

   La first-run et ce postflight constituent l’historique immuable du schéma initial. S’ils sont déjà installés, ne jamais les rejouer et commencer directement à l’étape suivante.

6. Sur une base neuve comme sur une base déjà installée, exécuter le patch additif et idempotent qui ouvre le studio aux trois éditions :

   ```text
   ops/sql/2026-08-31_ai_media_generation_studio_all_plans.sql
   ```

   Puis exiger `PASS` sur ses quatre contrôles read-only :

   ```text
   ops/sql/2026-08-31_ai_media_generation_studio_all_plans_postflight_read_only.sql
   ```

7. Appliquer ensuite la migration additive et idempotente des nouveaux plafonds, sans modifier ni rejouer la migration first-run historique :

   ```text
   ops/sql/2026-08-31_ai_media_generation_quota_limits_20_5_30_10.sql
   ```

   Puis exiger `PASS` sur son postflight en lecture seule :

   ```text
   ops/sql/2026-08-31_ai_media_generation_quota_limits_20_5_30_10_postflight_read_only.sql
   ```

8. Appliquer ensuite le patch additif des brouillons temporaires privés :

   ```text
   ops/sql/2026-08-31_ai_media_generation_temporary_drafts.sql
   ```

   Puis exiger `PASS` sur son postflight en lecture seule :

   ```text
   ops/sql/2026-08-31_ai_media_generation_temporary_drafts_postflight_read_only.sql
   ```

   Ce patch doit précéder le code qui expose la validation, le refus et la purge des aperçus temporaires.

9. Vérifier les limites, les fonctions, les RLS et les droits avec les requêtes complémentaires ci-dessous.
10. Configurer les variables dans l’environnement **Preview** Vercel.
11. Déployer un Preview du même commit et réaliser les smokes à coût borné.
12. Vérifier les traces Vercel, AI Gateway, Supabase et Storage pendant la fenêtre d’observation.
13. Configurer les mêmes variables en Production, puis seulement alors promouvoir le build validé.
14. Réaliser le smoke Production minimal : une image sans texte et une lecture privée sur un établissement de test. Ne lancer une vidéo Production que si le smoke vidéo Preview n’est pas représentatif de l’infrastructure finale.

La migration peut précéder le code : ses tables restent inertes tant que les routes ne les utilisent pas. L’inverse est interdit, car le code échouerait avant même de contacter la Gateway.

Cette installation est volontairement **strictement additive et first-run** : `CREATE` simple pour tables, indexes, triggers, policies et fonctions, `INSERT` simple pour les trois plans, aucun `DROP`, `DELETE`, `TRUNCATE`, `CREATE OR REPLACE`, `ALTER … DROP` ni `ON CONFLICT … DO UPDATE`. Si un objet cible existe, le `DO` initial lève `AI_MEDIA_INSTALL_COLLISION` avant la première écriture et la transaction entière est annulée.

Le postflight ouvre lui aussi explicitement une transaction `READ ONLY`. Son unique ligne attendue est `verdict = PASS`, `checked_objects = 37`, `failed_count = 0` et `failed_checks = []`. Il contrôle les trois tables et leur RLS, les trois plans exacts, les sept fonctions/signatures, les trois triggers, les trois policies de lecture, le droit `SELECT` sans `INSERT`/`UPDATE`/`DELETE` pour `authenticated`, ainsi que les droits tables/RPC de `service_role`. Il vérifie aussi que `PUBLIC`, `anon` et `authenticated` ne peuvent exécuter aucune des sept fonctions.

Un `FAIL` est bloquant : archiver `failed_checks`, ne pas déployer l’application et ne pas rejouer la migration first-run. Corriger le schéma uniquement par une nouvelle migration additive, datée et revue, puis exécuter un nouveau postflight.

### Vérifications SQL après migration

```sql
select edition, image_monthly_limit, video_monthly_limit, studio_enabled
from public.ai_media_plan_limits
order by case edition
  when 'standard' then 1
  when 'premium' then 2
  when 'founder' then 3
end;

select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_ai_media_generation_quota',
    'reserve_ai_media_generation',
    'complete_ai_media_generation',
    'fail_ai_media_generation',
    'expire_ai_media_generation_reservations'
  )
order by routine_name;

select grantee, routine_name, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'get_ai_media_generation_quota',
    'reserve_ai_media_generation',
    'complete_ai_media_generation',
    'fail_ai_media_generation',
    'expire_ai_media_generation_reservations'
  )
order by routine_name, grantee;
```

Les RPC doivent être `SECURITY DEFINER` avec un `search_path` fixe. `anon` et `authenticated` ne doivent avoir aucun droit d’exécution sur ces RPC ; l’API les appelle avec `service_role`. Les utilisateurs authentifiés peuvent seulement lire leurs lignes via les RLS basées sur `inrcy_can_access_account(account_id)`.

## 5. Variables Vercel

### Obligatoires ou déjà requises par l’application

- `AI_GATEWAY_API_KEY` **ou** l’authentification OIDC Vercel (`VERCEL_OIDC_TOKEN`) ;
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` ;
- `KV_REST_API_URL` et `KV_REST_API_TOKEN` pour le garde-fou économique par établissement ;
- `VERCEL_CRON_SECRET` ou `CRON_SECRET` pour les crons existants ;
- `FFMPEG_PATH` si l’exécutable embarqué n’est pas utilisé dans l’environnement cible.

La clé Gateway et le service role restent exclusivement côté serveur. Aucune variable de ce flux ne doit être préfixée par `NEXT_PUBLIC_`.

### Modèles média optionnels

- `AI_GATEWAY_IMAGE_MODEL` — surcharge au format `provider/model` ;
- `AI_GATEWAY_VIDEO_MODEL` — surcharge au format `provider/model`.

Sans surcharge, le serveur utilise ses modèles par défaut versionnés dans le code. Au moment de ce lot, les valeurs de référence sont `openai/gpt-image-2` pour l’image et `bfl/flux-3-video` pour la vidéo. Vérifier leur présence et leur tarification dans le catalogue AI Gateway de l’équipe avant chaque promotion ; ne pas remplacer un modèle sans refaire les smokes de format, durée, coût et sécurité.

Le bucket privé et les URL signées protègent la médiathèque iNrCy, mais ne changent pas la politique de conservation du fournisseur IA. Au moment de ce lot, la fiche Gateway de GPT Image 2 n’annonce pas de Zero Data Retention. Valider le cadre contractuel et l’information fournie aux pros avant activation ; le registre iNrCy ne conserve volontairement que la version et l’empreinte SHA-256 du prompt compilé, pas son texte intégral.

Les anciens noms `AI_MEDIA_IMAGE_MODEL` et `AI_MEDIA_VIDEO_MODEL` ne font pas partie du contrat de déploiement. Ne pas les créer dans Vercel.

### Garde-fous opérationnels optionnels

Le runtime possède des valeurs conservatrices par défaut. Les surcharges suivantes ne doivent être utilisées qu’après calibration en Preview :

- `AI_MEDIA_IMAGE_COST_MICRO_USD` et `AI_MEDIA_VIDEO_COST_MICRO_USD` : réservation de coût estimé pour le garde-fou Gateway ;
- `AI_MEDIA_IMAGE_TIMEOUT_MS` et `AI_MEDIA_VIDEO_TIMEOUT_MS` : délais maximums, bornés côté serveur.
- `AI_GATEWAY_MAX_COST_MICRO_USD_PER_ACCOUNT_DAY` : le défaut du code est `20000000`. Toute valeur Vercel existante surcharge ce défaut et doit rester au moins à `20000000` pour ne pas bloquer un Premium qui utilise légitimement 10 vidéos et 30 images le même jour.

La réservation vidéo par défaut est `1500000` micro-USD : elle couvre un rendu FLUX 3 full HD non-draft de 8 secondes à 0,17 USD/s (1,36 USD) avec une marge raisonnable. Une valeur trop basse affaiblit le coupe-circuit économique. Une valeur trop haute peut refuser prématurément une génération légitime. Documenter toute modification dans le journal de déploiement.

### Portée Vercel

1. Ajouter d’abord les variables à Preview et redéployer : les changements d’environnement ne modifient pas un build déjà en cours.
2. Ne copier vers Production qu’après les smokes Preview.
3. Lancer `npm run verify:env` avec les variables de chaque environnement exportées par le processus de déploiement, sans jamais imprimer leurs valeurs.

## 6. Assets musique et fichiers serveur

Les dix fichiers attendus se trouvent sous `assets/media-generation/soundtracks/` et doivent être inclus dans l’artefact serveur Vercel. Le manifeste et les WAV doivent rester versionnés ensemble.

Avant promotion, vérifier :

- dix pistes présentes, toutes lisibles et d’une durée de 8 secondes avec fondu propre ;
- aucune piste sous licence externe non documentée ;
- un test `withMusic=true` dans le Preview sans erreur `ENOENT` ;
- un MP4 final de 8 secondes contenant la piste attendue et sans dépassement de durée ;
- un MP4 `withMusic=false` sans piste ajoutée ;
- la présence de FFmpeg dans la fonction serveur réellement exécutée.

## 7. Vérifications locales avant déploiement

```bash
npm run verify:env
npm run typecheck
npx eslint lib/aiMediaGeneration*.ts lib/aiGeneratedMediaRegistry.ts app/api/media-generation app/dashboard/_hooks/useMediaGeneration.ts app/dashboard/_components/MediaGenerator.tsx app/dashboard/generer-media tests/ai-media-generation tests/media-generation tests/dashboard/media-generation-ui.test.mts --max-warnings=9999
npm run test:ai-media-generation
npm run test:multicompte
npm run test:ai-gateway
npm run test:media-pipeline:step2
```

Sur un runner qui interdit la création de sous-processus par le test runner Node, utiliser uniquement pour ce runner :

```bash
node --test --test-isolation=none --experimental-strip-types tests/ai-media-generation/*.test.mts
```

Le mode `STRICT=1 npm run verify:env` reste un gate d’environnement complet : les deux overrides de modèle sont optionnels et leur absence ne doit pas faire échouer le build.

## 8. Smoke multicompte à coût borné

Préparer un utilisateur de QA membre de trois établissements distincts A, B et C. Noter les trois UUID et l’édition résolue pour le bundle du propriétaire. Une édition owner-scoped commune aux trois comptes est compatible avec ce lot ; ce sont les compteurs, jobs, coûts Gateway et médias qui doivent impérativement rester séparés. Le serveur doit appeler le resolver sémantique par compte actif (`getDashboardEditionForAccountId(activeUserId)`), même si son implémentation remonte aujourd’hui à l’entitlement du propriétaire.

Des éditions différentes au sein du même bundle ne font pas partie de ce lot et nécessiteraient une évolution billing distincte avant d’être testées ou vendues.

### Isolation et idempotence

1. Activer A, relever ses compteurs image/vidéo et ceux de B/C.
2. Générer dans A une image sans texte avec une nouvelle `requestId`.
3. Vérifier : un job A `completed`, `used_count(image)` de A à +1, aucun changement pour B/C et un média avec `user_id = A`.
4. Rejouer exactement la même requête et la même `requestId`. Le même job et le même média doivent être renvoyés, sans second débit ni second appel Gateway.
5. Activer B et réutiliser volontairement la même valeur de `requestId`. B doit créer son propre job : l’unicité est `(account_id, request_key)`, pas globale.
6. Attacher ensuite le média de A à plusieurs brouillons/publications depuis la médiathèque. Aucun nouveau job de génération et aucun compteur supplémentaire ne doivent apparaître.
7. Vérifier que B et C ne peuvent ni lister ni signer le média de A.

### Changement d’établissement pendant une génération

Lancer l’unique vidéo réelle du smoke depuis A, avec musique, puis passer l’interface sur B pendant l’attente. La requête serveur doit conserver l’`activeUserId` résolu à son démarrage : quota, garde-fou économique, chemin Storage, ligne de médiathèque et job doivent tous rester sous A. B ne doit recevoir aucun débit et ne doit pas voir le média.

Ce scénario valide aussi le bundling des pistes et limite le coût à une vidéo réelle. Les variantes vidéo sans musique sont couvertes localement ; ne multiplier les appels réels qu’en cas de différence d’infrastructure.

### Éditions

- Standard : Booster et atelier avancé autorisés dans les limites communes 20/5.
- Premium : Booster et atelier avancé autorisés avec limites communes 30/10.
- Founder : Booster et atelier avancé autorisés avec limites communes 150/12.
- Un changement de plan ne doit jamais déplacer les compteurs vers un autre `account_id`.

### Échec, concurrence et expiration

- Forcer en staging un échec fournisseur contrôlé après réservation : le job devient `failed`, `reserved_count` revient à sa valeur initiale et `used_count` ne change pas.
- Envoyer deux réservations concurrentes sur le dernier slot disponible : une seule doit obtenir `reserved`, l’autre `quota_reached`.
- Envoyer deux fois simultanément la même clé et la même empreinte : un seul job doit être créé, le second résultat doit être `replayed`.
- Envoyer la même clé avec une empreinte différente : résultat de conflit, aucun débit supplémentaire.
- Créer en staging une réservation avec le TTL minimum autorisé, attendre son expiration, puis lire le quota. Le nettoyage paresseux doit marquer le job `expired` et libérer la réservation même si aucun cron n’est passé.

Les tests de concurrence et d’expiration peuvent utiliser un client QA serveur et un plafond temporaire transmis par l’API serveur. Ne jamais exposer le service role ni le `limitOverride` au navigateur.

## 9. Contrôles d’intégrité et de confidentialité

Les requêtes suivantes doivent retourner zéro ligne après les smokes :

```sql
with ledger as (
  select
    account_id,
    quota_period_start as period_start,
    media_kind,
    count(*) filter (where status = 'completed')::integer as completed_jobs,
    count(*) filter (where status in ('reserved', 'processing'))::integer as live_reservations
  from public.ai_media_generation_jobs
  group by account_id, quota_period_start, media_kind
)
select
  u.account_id,
  u.period_start,
  u.media_kind,
  u.used_count,
  u.reserved_count,
  coalesce(l.completed_jobs, 0) as completed_jobs,
  coalesce(l.live_reservations, 0) as live_reservations
from public.ai_media_monthly_usage u
left join ledger l
  on l.account_id = u.account_id
 and l.period_start = u.period_start
 and l.media_kind = u.media_kind
where u.used_count <> coalesce(l.completed_jobs, 0)
   or u.reserved_count <> coalesce(l.live_reservations, 0)
   or u.used_count < 0
   or u.reserved_count < 0;

select j.id, j.account_id, j.media_kind, j.output_media_id
from public.ai_media_generation_jobs j
join public.pro_media_library m on m.id = j.output_media_id
where j.status = 'completed'
  and (
    m.user_id <> j.account_id
    or m.media_type <> j.media_kind
    or m.upload_status <> 'uploaded'
  );
```

Un job `completed` peut légitimement conserver `output_media_id = null` après une suppression physique du média : `ON DELETE SET NULL` préserve ainsi l’historique de consommation. `completed_at` reste obligatoire. Cette situation n’est donc pas une anomalie dans la seconde requête, tandis que la RPC `complete_ai_media_generation` exige toujours un média non nul, uploadé et appartenant au même établissement lors de la finalisation initiale.

Contrôler également chaque média généré :

- `bucket_name = 'inrcy-pro-media'` ;
- `storage_path` préfixé par `users/{accountId}/ai-generated/` ;
- `client_media_key = 'ai-media:{jobId}'` ;
- `upload_protocol = 'server_legacy'` ;
- bucket non public ;
- accès uniquement par URL signée et via un membre du bon établissement.

## 10. Observation après promotion

Pendant au moins une journée puis sur un changement de mois UTC, surveiller :

- taux de `completed`, `failed`, `expired` et `quota_reached` par type de média ;
- réservations restant en `reserved` ou `processing` après leur échéance ;
- dépenses et erreurs par modèle dans Vercel AI Gateway ;
- refus du garde-fou économique par `account_id` ;
- temps de génération et timeouts image/vidéo ;
- échecs d’écriture Storage, de registre et de normalisation ;
- absence d’URL publique ou de lecture croisée entre établissements ;
- cohérence des compteurs avec la requête d’intégrité ci-dessus.

La lecture et la réservation libèrent paresseusement les entrées expirées du compte actif. Pour nettoyer aussi les comptes inactifs, le service role ou un opérateur SQL peut appeler par lot :

```sql
select public.expire_ai_media_generation_reservations(100);
```

Une planification globale peut être ajoutée séparément après revue opérationnelle. Elle n’est pas indispensable à la justesse d’un compte actif et ne fait pas partie de ce lot.

## 11. Rollback prudent

Le rollback privilégié est applicatif et non destructif.

1. Stopper la promotion ou redéployer le dernier build connu sans les entrées de génération.
2. Laisser les tables et le ledger SQL en place. La migration est additive ; les conserver protège l’audit, l’idempotence et les compteurs déjà consommés.
3. Laisser les médias déjà créés dans la médiathèque privée. Ils appartiennent au pro et leur suppression n’est pas un rollback technique.
4. Laisser expirer les réservations en cours ou les terminer avec la RPC `fail_ai_media_generation`. Ne jamais décrémenter `reserved_count` manuellement.
5. Retirer les overrides `AI_GATEWAY_IMAGE_MODEL` et `AI_GATEWAY_VIDEO_MODEL` seulement après retour au build précédent. Ne pas supprimer la clé Gateway si les autres modules IA l’utilisent.
6. Vérifier qu’aucun job n’est bloqué et que les deux requêtes d’intégrité retournent zéro ligne.

Ne pas exécuter de `drop table`, ne pas vider le ledger et ne pas supprimer en masse les objets Storage pendant un incident. Si une suppression définitive du schéma devient juridiquement ou techniquement nécessaire, préparer une migration distincte après export, délai de rétention, analyse des clés étrangères et validation humaine. Ce runbook ne contient volontairement aucun SQL destructif.

Ne jamais tenter de « réparer » un rollback applicatif en rejouant la migration first-run : elle doit répondre `AI_MEDIA_INSTALL_COLLISION`. Une correction de schéma passe exclusivement par une nouvelle migration additive et revue séparément.

## 12. Gate de promotion

La Production n’est autorisée que si tous les points suivants sont vrais :

- preflight read-only archivé avec verdict `READY` et aucune collision ;
- installation first-run absente de l’historique puis enregistrée une seule fois après succès ;
- migration staging réussie, postflight read-only archivé avec `PASS`/37 contrôles et vérifications SQL complémentaires conformes ;
- variables Preview validées sans secret côté client ;
- modèles présents dans le catalogue Gateway et coût accepté ;
- dix pistes musicales incluses dans l’artefact serveur ;
- suite complète média IA/quota/sécurité/UI, typecheck et lint réussis ;
- smoke A/B/C sans débit sur le mauvais établissement ;
- idempotence et concurrence validées ;
- brouillon généré privé et signé, puis média visible dans la bonne médiathèque uniquement après validation ;
- réutilisation de la médiathèque sans nouvelle consommation ;
- atelier accessible aux trois éditions, avec quotas 20/5, 30/10 et 150/12 ;
- plan de retour au build précédent identifié et sauvegarde Supabase disponible.
