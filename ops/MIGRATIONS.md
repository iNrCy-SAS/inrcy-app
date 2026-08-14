# Database migrations & safety

## Principles

1. **Backward compatible first**
   - Add columns/tables/indexes without breaking running code.
2. **Deploy code second**
   - Code can start using the new fields.
3. **Clean-up last**
   - Drop old columns only after you’re sure no deployment needs them.

## Safe migration patterns

### Add a column

1. Add column nullable
2. Deploy code that writes it
3. Backfill data
4. Add NOT NULL constraint (optional)

### Change types

Prefer: add a new column, backfill, swap reads, then drop old.

### Indexes

- Add indexes for `user_id` + frequent filters (`created_at`, `status`).
- Validate query plans in Supabase Query Performance.

## Rollback guidance

Prefer **forward-fix** migrations rather than "down" in production.

If you must restore:
- Use Supabase backup/PITR
- Redeploy last-known-good Vercel build

## 2026-08-14 - Supabase Security Advisor function hardening

Run after the existing iNrSend, publication, onboarding and media-pipeline
migrations:

```text
ops/sql/2026-08-14_security_advisor_function_hardening.sql
```

The migration pins the search path of legacy helpers, removes direct API
execution from trigger-only/server-only functions and makes future
postgres-owned functions private-by-default. Authenticated business RPCs used
by invoices, account scope, daily stats and onboarding remain available.

## 2026-07-15 — iNrAgent Lot C, contexte vidéo persistant

Exécuter avant ou juste après le déploiement :

```text
ops/sql/2026-07-15_inragent_video_ai_context_cache.sql
```

La migration ajoute uniquement des colonnes et un index à `pro_media_library`. Elle est idempotente et le code garde un fallback non bloquant tant qu'elle n'est pas appliquée.

## 2026-07-25 - Dashboard onboarding state

Run before deploying onboarding step 2:

```text
ops/sql/2026-07-25_dashboard_onboarding_state.sql
```

This migration creates an account-scoped onboarding state. Existing accounts are backfilled as completed; future accounts start at profile / pending.

## 2026-07-27 - iNr'Send safe campaigns

Run in this order before deploying Step 2:

```text
ops/sql/2026-07-27_inrsend_step1_safe_dispatch.sql
ops/sql/2026-07-27_inrsend_step2_intelligent_campaigns.sql
```

Step 1 creates the distributed mailbox lock. Step 2 adds campaign pause metadata, failure diagnostics, the per-campaign deduplication key and the atomic recipient claim function.


## 2026-07-27 - iNr'Send reputation protection

Run after the Step 1 and Step 2 migrations, before deploying Step 3:

```text
ops/sql/2026-07-27_inrsend_step3_reputation_protection.sql
```

Step 3 adds the server-managed mailbox reputation state, DNS authentication audit cache and protected delivery-feedback storage.

## 2026-07-29 — Pipeline média universel Étape 7

Exécuter après les migrations Étapes 2 à 6 et avant d’activer la consommation unifiée :

```text
ops/sql/2026-07-29_media_pipeline_step7_unified_consumption.sql
```

La migration ajoute uniquement des index de lecture pour les workspaces et variantes normalisées. Vérification sans écriture :

```text
ops/sql/2026-07-29_media_pipeline_step7_verify.sql
```

Activer ensuite, pendant la bascule contrôlée :

```text
MEDIA_PIPELINE_UNIFIED_CONSUMPTION_V1=true
NEXT_PUBLIC_MEDIA_PIPELINE_UNIFIED_CONSUMPTION_V1=true
```

## 2026-07-29 — Pipeline média universel Étape 8

Exécuter après l’Étape 7 et avant la bascule stricte finale :

```text
ops/sql/2026-07-29_media_pipeline_step8_legacy_cutover.sql
```

La migration ajoute uniquement deux index de lecture. Vérification sans écriture :

```text
ops/sql/2026-07-29_media_pipeline_step8_verify.sql
```

Les anciens transports restent disponibles pour rollback. Leur sortie du parcours actif est commandée par :

```text
MEDIA_PIPELINE_LEGACY_CUTOVER_V1=true
NEXT_PUBLIC_MEDIA_PIPELINE_LEGACY_CUTOVER_V1=true
```

Ne pas activer ces deux variables avant la certification finale de toutes les étapes.


## 2026-07-29 — Pipeline média universel Étape 9

L'Étape 9 ne possède aucune migration d'écriture. Après les migrations Étapes
2, 3, 5, 6, 7 et 8, exécuter le rapport final strictement en lecture seule :

```text
ops/sql/2026-07-29_media_pipeline_step9_final_certification.sql
```

Puis suivre la procédure :

```text
ops/MEDIA_PIPELINE_PRODUCTION_CUTOVER_2026-07-29.md
```

Commandes de certification :

```text
npm run certify:media-pipeline
npm run verify:media-pipeline:rollout
npm run smoke:media-pipeline
```

Aucun rollback SQL n'est prévu. Le retour arrière s'effectue par désactivation
des flags de cutover, puis de consommation unifiée si nécessaire.

## 2026-07-30 — Pipeline média universel Étape 10

Après les migrations et vérifications des Étapes 2 à 9, exécuter :

```text
ops/sql/2026-07-30_media_pipeline_step10_performance_hardening.sql
```

Puis contrôler le résultat avec la requête strictement en lecture seule :

```text
ops/sql/2026-07-30_media_pipeline_step10_verify.sql
```

Cette entrée documente des fichiers SQL déjà présents dans le dépôt. Elle ne
modifie aucune migration et n'exécute aucune opération sur Supabase. Les détails
de déploiement sont décrits dans :

```text
docs/MEDIA_PIPELINE_STEP10_FINAL_HARDENING_2026-07-30.md
```

