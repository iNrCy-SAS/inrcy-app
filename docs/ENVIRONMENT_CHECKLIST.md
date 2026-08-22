# Checklist variables d'environnement iNrCy

Ce fichier sert de suivi des variables nécessaires à iNrCy.

Ne jamais écrire les valeurs secrètes dans ce fichier. Conserver uniquement les noms, l'usage et le statut.

## Règle actuelle

Tant que TikTok, Pinterest et Trustpilot ne sont pas complètement disponibles / validés, le check d'environnement peut rester en non-strict :

```bash
STRICT=0 npm run verify:env
```

Quand toutes les intégrations sont prêtes en Production et Preview, il sera possible de passer progressivement en strict :

```bash
STRICT=1 npm run verify:env
```

## Core app

- [ ] `NEXT_PUBLIC_APP_URL`
- [ ] `NEXT_PUBLIC_SITE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`

## Supabase / auth / sécurité interne

- [ ] `INRCY_CREDENTIALS_SECRET`
- [ ] `INRCY_WIDGETS_SIGNING_SECRET`
- [ ] `INRCY_DIRECTORY_PURGE_SECRET` — secret HMAC d’au moins 32 caractères, identique dans Vercel et `wp-config.php`
- [ ] `INRCY_DIRECTORY_PURGE_URL` — facultatif, défaut `https://inrcy.com/wp-json/inrcy/v1/directory-cache/purge`
- [ ] `INRCY_WIDGET_ALLOWED_ORIGINS`
- [ ] `SUPABASE_NEW_USER_WEBHOOK_SECRET`
- [ ] `INRCY_NEW_USER_ALERT_EMAIL`
- [ ] `INRCY_DIAGNOSTIC_REPORT_TO`
- [ ] `ADMIN_SECRET`
- [ ] `INRCY_ADMIN_USER_ID`
- [ ] `INRCY_ADMIN_GOOGLE_EMAIL`

## Health / cron / monitoring

- [ ] `HEALTHCHECK_TOKEN`
- [ ] `VERCEL_CRON_SECRET` ou `CRON_SECRET`
- [ ] `HEALTHCHECK_ALERT_TO`
- [ ] `SENTRY_DSN`
- [ ] `NEXT_PUBLIC_SENTRY_DSN`
- [ ] `SENTRY_AUTH_TOKEN`
- [ ] `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` — clé base64 stable de 16, 24 ou 32 octets, définie avant le build et identique entre les instances
- [ ] `NEXT_DEPLOYMENT_ID` — identifiant de déploiement stable par version si l'hébergement ne fournit pas déjà une valeur de version

## Upstash / Vercel KV

- [ ] `KV_REST_API_URL`
- [ ] `KV_REST_API_TOKEN`
- [ ] `ENABLE_UPSTASH_IN_DEV` uniquement en besoin local contrôlé

Limites optionnelles :

- [ ] `RL_BOOSTER_GENERATE_PER_MIN`
- [ ] `RL_TEMPLATES_RENDER_PER_MIN`
- [ ] `QUOTA_TEMPLATES_RENDER_PER_DAY`
- [ ] `RL_PUBLISH_NOW_PER_MIN`
- [ ] `QUOTA_PUBLISH_NOW_PER_DAY`
- [ ] `RL_WIDGET_ISSUE_TOKEN_PER_MIN`
- [ ] `QUOTA_WIDGET_ISSUE_TOKEN_PER_DAY`

## Stripe

- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] `STRIPE_PRICE_STARTER_ID`
- [ ] `STRIPE_PRICE_YEARLY`
- [ ] `STRIPE_PRICE_ACCEL_ID`
- [ ] `STRIPE_PRICE_ACCEL_YEARLY_ID`
- [ ] `STRIPE_PRICE_SPEED_ID`
- [ ] `STRIPE_PRICE_FULL_ID`

## Mails transactionnels / iNrSend

- [ ] `TX_SMTP_HOST`
- [ ] `TX_SMTP_PORT`
- [ ] `TX_SMTP_USER`
- [ ] `TX_SMTP_PASS`
- [ ] `TX_MAIL_FROM`
- [ ] `MONITORING_SMTP_USER` (alertes internes ; repli sur `TX_SMTP_USER`)
- [ ] `MONITORING_SMTP_PASS` (alertes internes ; repli sur `TX_SMTP_PASS`)
- [ ] `MONITORING_MAIL_FROM` (alertes internes ; repli sur `TX_MAIL_FROM`)
- [ ] `MONITORING_SMTP_HOST` / `MONITORING_SMTP_PORT` (optionnels ; repli sur `TX_SMTP_HOST` / `TX_SMTP_PORT`)
- [ ] `TX_SMTP_AUTH_BACKOFF_SECONDS` (optionnel, défaut : 3600)
- [ ] `HEALTHCHECK_FAILURE_LOG_DEDUPE_SECONDS` (optionnel, défaut : 3600)
- [ ] `INRSEND_MAIL_WEBHOOK_SECRET`
- [ ] `INRSEND_WEBHOOK_SECRET`
- [ ] `INRSEND_CAMPAIGN_BATCH_SIZE` (optionnel, maximum de securite : 5)
- [ ] `INRSEND_CAMPAIGN_DELAY_MS` (optionnel, minimum de securite : 8000)
- [ ] `INRSEND_CAMPAIGN_BATCH_PAUSE_MS` (optionnel, minimum de securite : 60000)
- [ ] `INRSEND_CAMPAIGN_HOURLY_LIMIT` (optionnel, maximum de securite : 150)
- [ ] `INRSEND_CAMPAIGN_DAILY_LIMIT` (optionnel, maximum de securite : 300)
- [ ] `INRSEND_CAMPAIGN_MAX_ACTIVE_PER_BOX` (verrouille a 1)
- [ ] `INRSEND_CAMPAIGN_LOCK_LEASE_SECONDS` (optionnel, defaut : 180)

## IA / Vercel AI Gateway

- [ ] `AI_GATEWAY_API_KEY` ou authentification OIDC Vercel — transport principal pour la génération texte/vision et la transcription
- [ ] `AI_GATEWAY_MODEL` (format `provider/model`)
- [ ] `AI_GATEWAY_VISION_MODEL` si modèle vision distinct
- [ ] `AI_GATEWAY_BASE_URL` seulement si surcharge volontaire
- [ ] `AI_GATEWAY_FALLBACK_MODEL` (optionnel ; secours Gateway des moteurs non-OpenAI, défaut `openai/gpt-4o-mini`)
- [ ] `AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL` (optionnel ; secours Gateway lorsque ChatGPT est sélectionné, défaut `google/gemini-2.5-flash-lite`)
- [ ] `AI_GATEWAY_TRANSCRIBE_MODEL` (optionnel, défaut `openai/gpt-4o-transcribe`)
- [ ] `AI_GATEWAY_TRANSCRIBE_FALLBACK_MODEL` (optionnel, défaut `openai/whisper-1`)

### OpenAI direct — ultime secours indépendant

- [ ] `OPENAI_API_KEY` — recommandé en Production ; utilisé une seule fois uniquement après échec du moteur choisi et du secours Gateway
- [ ] `OPENAI_DIRECT_FALLBACK_MODEL` (optionnel, défaut `gpt-4o-mini`)

La clé directe reste exclusivement côté serveur. Elle ne contourne jamais les quotas produit, les limites économiques, les requêtes invalides ni les délais de sécurité.

## Google / Google Business / YouTube

- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_REDIRECT_URI`
- [ ] `GOOGLE_GMB_REDIRECT_URI`
- [ ] `GOOGLE_STATS_REDIRECT_URI`
- [ ] `GOOGLE_RISC_AUDIENCES`
- [ ] `GOOGLE_RISC_RECEIVER_ENABLED`
- [ ] `GOOGLE_YOUTUBE_SHORTS_CLIENT_ID`
- [ ] `GOOGLE_YOUTUBE_SHORTS_CLIENT_SECRET`
- [ ] `GOOGLE_YOUTUBE_SHORTS_REDIRECT_URI`
- [ ] `GOOGLE_YOUTUBE_SHORTS_SCOPES`
- [ ] `GOOGLE_YOUTUBE_CLIENT_ID`
- [ ] `GOOGLE_YOUTUBE_CLIENT_SECRET`
- [ ] `YOUTUBE_SHORTS_CLIENT_ID`
- [ ] `YOUTUBE_SHORTS_CLIENT_SECRET`
- [ ] `YOUTUBE_SHORTS_REDIRECT_URI`
- [ ] `YOUTUBE_SHORTS_SCOPES`
- [ ] `YOUTUBE_CLIENT_ID`
- [ ] `YOUTUBE_CLIENT_SECRET`

## Meta / Facebook / Instagram

- [ ] `FACEBOOK_APP_ID`
- [ ] `FACEBOOK_APP_SECRET`
- [ ] `FACEBOOK_REDIRECT_URI`
- [ ] `FACEBOOK_LOGIN_FOR_BUSINESS_CONFIG_ID`
- [ ] `INSTAGRAM_REDIRECT_URI`
- [ ] `INSTAGRAM_LOGIN_FOR_BUSINESS_CONFIG_ID`

## LinkedIn

- [ ] `LINKEDIN_CLIENT_ID`
- [ ] `LINKEDIN_CLIENT_SECRET`
- [ ] `LINKEDIN_REDIRECT_URI`
- [ ] `LINKEDIN_API_VERSION`
- [ ] `LINKEDIN_SCOPE_OVERRIDES`

## Microsoft / Outlook

- [ ] `MICROSOFT_CLIENT_ID`
- [ ] `MICROSOFT_CLIENT_SECRET`
- [ ] `MICROSOFT_REDIRECT_URI`

## TikTok — en attente selon validation plateforme

À compléter quand les accès définitifs sont disponibles.

- [ ] `TIKTOK_CLIENT_KEY`
- [ ] `TIKTOK_CLIENT_SECRET`
- [ ] `TIKTOK_REDIRECT_URI`
- [ ] `TIKTOK_SCOPES`
- [ ] `TIKTOK_MEDIA_BASE_URL`
- [ ] `TIKTOK_MEDIA_SIGNING_SECRET`

## Pinterest — Accès Standard approuvé (Production)

Configurer les variables canoniques de Production. Le code iNrCy ne route plus vers le Sandbox.

- [ ] `PINTEREST_CLIENT_ID`
- [ ] `PINTEREST_CLIENT_SECRET`
- [ ] `PINTEREST_REDIRECT_URI`
- [ ] `PINTEREST_OAUTH_SCOPES`
- [ ] `PINTEREST_APP_ID` (alias legacy uniquement)
- [ ] `PINTEREST_APP_SECRET` (alias legacy uniquement)

## Trustpilot — en attente selon validation plateforme

À compléter quand les accès définitifs sont disponibles.

- [ ] `TRUSTPILOT_CLIENT_ID`
- [ ] `TRUSTPILOT_CLIENT_SECRET`
- [ ] `TRUSTPILOT_REDIRECT_URI`
- [ ] `TRUSTPILOT_AUTHOR_BUSINESS_USER_ID`
- [ ] `TRUSTPILOT_API_KEY`
- [ ] `TRUSTPILOT_API_SECRET`

## E2E / tests

- [ ] `E2E_BASE_URL`
- [ ] `E2E_EMAIL`
- [ ] `E2E_PASSWORD`
- [ ] `E2E_ALLOW_WRITES`

## Divers

- [ ] `FFMPEG_PATH`
- [ ] `NEXTAUTH_SECRET`
- [ ] `NEXT_PUBLIC_BOUTIQUE_EMAIL`
- [ ] `NEXT_PUBLIC_INRBADGE_BASE_URL`
- [ ] `NEXT_PUBLIC_COMMIT_SHA`
- [ ] `VERCEL_GIT_COMMIT_SHA`
- [ ] `CRM_CAMPAIGN_MAX_RECIPIENTS` (optionnel, plafond dur : 300)

## Pipeline média universel — activation progressive

- [ ] `NEXT_PUBLIC_MEDIA_PIPELINE_UPLOADS_V1=true` uniquement pendant la phase de test contrôlée puis à la bascule finale.
- [ ] `NEXT_PUBLIC_MEDIA_PIPELINE_WORKSPACE_V1=true` uniquement après la migration Storage étape 3 et pour activer la persistance dès insertion de l’étape 4.
- [ ] `MEDIA_PIPELINE_IMAGE_NORMALIZATION_V1=true` uniquement après la migration SQL Étape 5 pour activer le worker Sharp et les variantes canonique / IA / miniature.
- [ ] Migration `2026-07-29_media_pipeline_step3_universal_direct_upload.sql` exécutée avant activation.
- [ ] Migration `2026-07-29_media_pipeline_step5_image_normalization.sql` exécutée avant activation du flag image.
- [ ] Buckets `booster` et `inrcy-pro-media` contrôlés avec le SQL de vérification Étape 3.
- [ ] Dans Supabase > Storage > Settings, vérifier que la limite globale d’upload est au moins égale au plafond réellement retenu pour iNrCy ; la limite globale reste prioritaire sur celle des buckets.
- [ ] `MEDIA_PIPELINE_VIDEO_NORMALIZATION_V1=true` uniquement après la migration SQL Étape 6 pour activer le worker FFmpeg et les variantes vidéo.
- [ ] `MEDIA_PIPELINE_UNIFIED_CONSUMPTION_V1=true` uniquement après la migration SQL Étape 7 pour faire relire les variantes normalisées par les routes serveur.
- [ ] `NEXT_PUBLIC_MEDIA_PIPELINE_UNIFIED_CONSUMPTION_V1=true` avec le flag serveur Étape 7 pour joindre la référence du workspace à Générer, Publier et Programmer.

## Pipeline média universel — certification Étape 9

Avant chaque redéploiement de palier :

- [ ] lancer `npm run verify:media-pipeline:rollout` avec les variables du déploiement ;
- [ ] vérifier que le palier annoncé correspond à `disabled`, `server_foundation`, `workspace_canary`, `unified_canary` ou `full_cutover` ;
- [ ] refuser tout déploiement classé `invalid` ;
- [ ] se rappeler que chaque modification d'un `NEXT_PUBLIC_*` exige un nouveau build Vercel ;
- [ ] lancer `npm run smoke:media-pipeline` après le déploiement ;
- [ ] au palier final, lancer les deux commandes avec `REQUIRE_MEDIA_PIPELINE_CUTOVER=1` ;
- [ ] exécuter `ops/sql/2026-07-29_media_pipeline_step9_final_certification.sql` ;
- [ ] vérifier `checks.media_pipeline` dans `/api/health/internal` ;
- [ ] vérifier que `inrcy-pro-media` reste privé ;
- [ ] vérifier l'absence de jobs avec lease expirée persistante ;
- [ ] conserver les routes historiques tant que la période d'observation n'est pas terminée.
