/*
 * Vérification dédiée de la configuration Pinterest iNrCy.
 * Ne journalise jamais les valeurs secrètes.
 */

const required = [
  "PINTEREST_CLIENT_ID",
  "PINTEREST_CLIENT_SECRET",
  "PINTEREST_REDIRECT_URI",
  "PINTEREST_ADS_REDIRECT_URI",
  "PINTEREST_OAUTH_SCOPES",
  "NEXT_PUBLIC_APP_URL",
  "INRCY_CREDENTIALS_SECRET",
];

const expectedScopes = new Set([
  "user_accounts:read",
  "boards:read",
  "boards:write",
  "pins:read",
  "pins:write",
]);
const expectedAdsScopes = ["ads:read", "ads:write", "boards:read", "boards:write", "pins:read", "pins:write"];

function value(key) {
  return String(process.env[key] || "").trim();
}

const missing = required.filter((key) => !value(key));

if (missing.length) {
  console.error("[pinterest-env] Variables manquantes:");
  for (const key of missing) console.error(`  - ${key}`);
  process.exit(1);
}

let appOrigin;
let appUrl;
let redirect;
let adsRedirect;
try {
  appUrl = new URL(value("NEXT_PUBLIC_APP_URL"));
  appOrigin = appUrl.origin;
  redirect = new URL(value("PINTEREST_REDIRECT_URI"));
  adsRedirect = new URL(value("PINTEREST_ADS_REDIRECT_URI"));
} catch {
  console.error(
    "[pinterest-env] NEXT_PUBLIC_APP_URL ou une URL de retour Pinterest n'est pas valide.",
  );
  process.exit(1);
}

if (redirect.protocol !== "https:" || adsRedirect.protocol !== "https:") {
  console.error(
    "[pinterest-env] Les URLs de retour Pinterest doivent utiliser HTTPS en production.",
  );
  process.exit(1);
}

if (redirect.pathname !== "/api/integrations/pinterest/callback") {
  console.error(
    "[pinterest-env] Le chemin de callback Pinterest est incorrect.",
  );
  console.error("  Attendu: /api/integrations/pinterest/callback");
  process.exit(1);
}

if (adsRedirect.pathname !== "/api/ads/pinterest/callback") {
  console.error(
    "[pinterest-env] Le chemin de callback Pinterest Ads est incorrect.",
  );
  console.error("  Attendu: /api/ads/pinterest/callback");
  process.exit(1);
}

if (redirect.origin !== adsRedirect.origin) {
  console.error(
    "[pinterest-env] Les callbacks Pinterest organique et Ads doivent utiliser la même origine HTTPS.",
  );
  process.exit(1);
}

const localApp = appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1";
if (!localApp && redirect.origin !== appOrigin) {
  console.error(
    "[pinterest-env] L'origine des callbacks Pinterest doit correspondre à NEXT_PUBLIC_APP_URL.",
  );
  process.exit(1);
}
if (localApp && redirect.origin !== appOrigin) {
  console.warn(`[pinterest-env] Développement local : callbacks distants contrôlés sur ${redirect.origin}.`);
}

const adsClientId = value("PINTEREST_ADS_CLIENT_ID");
const adsClientSecret = value("PINTEREST_ADS_CLIENT_SECRET");
if (Boolean(adsClientId) !== Boolean(adsClientSecret)) {
  console.error(
    "[pinterest-env] PINTEREST_ADS_CLIENT_ID et PINTEREST_ADS_CLIENT_SECRET doivent être fournis ensemble.",
  );
  process.exit(1);
}

const apiEnvironment = (value("PINTEREST_API_ENV") || "production").toLowerCase();
if (apiEnvironment !== "production") {
  console.error(
    "[pinterest-env] Pinterest est officiel dans iNrCy : PINTEREST_API_ENV doit valoir production ou être supprimée.",
  );
  process.exit(1);
}

const scopes = new Set(
  value("PINTEREST_OAUTH_SCOPES")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean),
);

const missingScopes = [...expectedScopes].filter((scope) => !scopes.has(scope));
if (missingScopes.length) {
  console.error("[pinterest-env] Scopes Pinterest manquants:");
  for (const scope of missingScopes) console.error(`  - ${scope}`);
  process.exit(1);
}

console.log("[pinterest-env] OK");
console.log(`  App origin: ${appOrigin}`);
console.log(`  Organic redirect path: ${redirect.pathname}`);
console.log(`  Ads redirect path: ${adsRedirect.pathname}`);
console.log(`  Ads credentials: ${adsClientId ? "dedicated pair" : "organic pair fallback"}`);
console.log(`  Ads scopes (code policy): ${expectedAdsScopes.join(",")}`);
console.log(`  API environment: ${apiEnvironment}`);
console.log(`  Scopes: ${[...scopes].join(",")}`);
