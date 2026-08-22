/*
 * Minimal env verification for safer deployments.
 *
 * Usage:
 *   node scripts/verify-env.mjs
 *
 * In CI you can set STRICT=1 to make missing vars fail the build.
 */

const strict = process.env.STRICT === "1";

/** @type {string[]} */
const required = [
  // Core URLs
  "NEXT_PUBLIC_APP_URL",

  // Supabase
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",

  // KV / Upstash (rate limits + quotas)
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",

  // Internal / ops
  "HEALTHCHECK_TOKEN",

  // Widgets / encrypted credentials
  "INRCY_WIDGETS_SIGNING_SECRET",
  "INRCY_CREDENTIALS_SECRET",
  "INRCY_DIRECTORY_PURGE_SECRET",

  // SMTP / transactional email
  "TX_SMTP_HOST",
  "TX_SMTP_PORT",
  "TX_SMTP_USER",
  "TX_SMTP_PASS",

  // Stripe
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_PRICE_STARTER_ID",
  "STRIPE_PRICE_YEARLY",
  "STRIPE_PRICE_ACCEL_ID",
  "STRIPE_PRICE_ACCEL_YEARLY_ID",
];

/** @type {{ label: string; keys: string[] }[]} */
const requiredGroups = [
  {
    label: "Cron secret",
    keys: ["VERCEL_CRON_SECRET", "CRON_SECRET"],
  },
  {
    label: "AI Gateway credentials",
    keys: ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"],
  },
];

/** @type {string[]} */
const optionalButRecommended = [
  // Admin-only routes / onboarding helpers
  "ADMIN_SECRET",
  "SUPABASE_NEW_USER_WEBHOOK_SECRET",
  "INRCY_NEW_USER_ALERT_EMAIL",
  "INRCY_TRIAL_SIGNUP_SECRET",
  "INRCY_DIRECTORY_PURGE_URL",

  // SMTP identity
  "TX_MAIL_FROM",
  "MONITORING_SMTP_USER",
  "MONITORING_SMTP_PASS",
  "MONITORING_MAIL_FROM",
  "MONITORING_SMTP_HOST",
  "MONITORING_SMTP_PORT",
  "MONITORING_SMTP_SECURE",
  "TX_SMTP_AUTH_BACKOFF_SECONDS",
  "HEALTHCHECK_FAILURE_LOG_DEDUPE_SECONDS",

  // Legacy / additional Stripe plans
  "STRIPE_PRICE_SPEED_ID",
  "STRIPE_PRICE_FULL_ID",

  // Observability
  "SENTRY_AUTH_TOKEN",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",

  // AI Gateway (transport principal ; credential vérifié dans requiredGroups)
  "AI_GATEWAY_MODEL",
  "AI_GATEWAY_VISION_MODEL",
  "AI_GATEWAY_FALLBACK_MODEL",
  "AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL",
  "AI_GATEWAY_MODEL_PRICING_JSON",
  "AI_GATEWAY_FALLBACK_INPUT_USD_PER_MILLION",
  "AI_GATEWAY_FALLBACK_OUTPUT_USD_PER_MILLION",

  // Ultime secours indépendant de la Gateway (recommandé en production)
  "OPENAI_API_KEY",
  "OPENAI_DIRECT_FALLBACK_MODEL",

  // Transcription via Vercel AI Gateway (modèles optionnels : valeurs par défaut intégrées)
  "AI_GATEWAY_TRANSCRIBE_MODEL",
  "AI_GATEWAY_TRANSCRIBE_FALLBACK_MODEL",
  "AI_GATEWAY_TRANSCRIPTION_URL",
  "AI_GATEWAY_ALLOWED_TRANSCRIPTION_MODELS",
  "HEALTHCHECK_ALERT_TO",

  // Integrations / OAuth
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_GMB_REDIRECT_URI",
  "GOOGLE_STATS_REDIRECT_URI",
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_REDIRECT_URI",
  "INSTAGRAM_REDIRECT_URI",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_REDIRECT_URI",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_REDIRECT_URI",

  // TikTok media pull endpoint (must stay on the verified public origin)
  "TIKTOK_MEDIA_BASE_URL",
  "TIKTOK_MEDIA_SIGNING_SECRET",
];

function hasValue(key) {
  return Boolean(process.env[key] && String(process.env[key]).trim() !== "");
}

function check(list, label) {
  const missing = list.filter((key) => !hasValue(key));
  if (missing.length) {
    console.warn(`\n[env] Missing ${label}:`);
    for (const key of missing) console.warn(`  - ${key}`);
  } else {
    console.log(`\n[env] OK: ${label}`);
  }
  return missing;
}

function checkGroups(groups) {
  const missing = [];
  for (const group of groups) {
    if (group.keys.some(hasValue)) continue;
    missing.push(`${group.label} (${group.keys.join(" or ")})`);
  }

  if (missing.length) {
    console.warn("\n[env] Missing required variable groups:");
    for (const group of missing) console.warn(`  - ${group}`);
  } else {
    console.log("\n[env] OK: required variable groups");
  }

  return missing;
}

const missingRequired = check(required, "required variables");
const missingRequiredGroups = checkGroups(requiredGroups);
check(optionalButRecommended, "optional (recommended) variables");

if ((missingRequired.length || missingRequiredGroups.length) && strict) {
  console.error("\n[env] STRICT=1 → failing due to missing required variables.");
  process.exit(1);
}

console.log("\n[env] done");
