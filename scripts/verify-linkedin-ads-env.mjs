/*
 * Vérification de la configuration LinkedIn Ads iNrCy.
 * Ne journalise jamais les identifiants ni les secrets.
 */

const required = [
  "LINKEDIN_ADS_CLIENT_ID",
  "LINKEDIN_ADS_CLIENT_SECRET",
  "LINKEDIN_ADS_REDIRECT_URI",
  "NEXT_PUBLIC_APP_URL",
  "INRCY_CREDENTIALS_SECRET",
];

const expectedApiVersion = "202609";
const readScope = "r_ads";
const manageScope = "rw_ads";

function value(key) {
  return String(process.env[key] || "").trim();
}

const missing = required.filter((key) => !value(key));
if (missing.length) {
  console.error("[linkedin-ads-env] Variables manquantes:");
  for (const key of missing) console.error(`  - ${key}`);
  process.exit(1);
}

let appUrl;
let redirect;
try {
  appUrl = new URL(value("NEXT_PUBLIC_APP_URL"));
  redirect = new URL(value("LINKEDIN_ADS_REDIRECT_URI"));
} catch {
  console.error("[linkedin-ads-env] NEXT_PUBLIC_APP_URL ou LINKEDIN_ADS_REDIRECT_URI n'est pas valide.");
  process.exit(1);
}

const localApp = ["localhost", "127.0.0.1"].includes(appUrl.hostname);
if (!localApp && redirect.protocol !== "https:") {
  console.error("[linkedin-ads-env] Le callback LinkedIn Ads doit utiliser HTTPS en production.");
  process.exit(1);
}
if (redirect.pathname !== "/api/ads/linkedin/callback") {
  console.error("[linkedin-ads-env] Chemin callback incorrect. Attendu: /api/ads/linkedin/callback");
  process.exit(1);
}
if (redirect.search || redirect.hash || redirect.username || redirect.password) {
  console.error("[linkedin-ads-env] Le callback LinkedIn Ads ne doit contenir ni identifiants, ni query string, ni fragment.");
  process.exit(1);
}
if (!localApp && redirect.origin !== appUrl.origin) {
  console.error("[linkedin-ads-env] Le callback LinkedIn Ads doit partager l'origine de NEXT_PUBLIC_APP_URL.");
  process.exit(1);
}

const version = value("LINKEDIN_ADS_API_VERSION") || expectedApiVersion;
if (!/^20\d{4}$/.test(version)) {
  console.error("[linkedin-ads-env] LINKEDIN_ADS_API_VERSION doit utiliser le format YYYYMM.");
  process.exit(1);
}
if (version !== expectedApiVersion) {
  console.warn(`[linkedin-ads-env] Version ${version} configurée ; le code et les tests ciblent ${expectedApiVersion}.`);
}

const organicRedirect = value("LINKEDIN_REDIRECT_URI");
if (organicRedirect && organicRedirect === redirect.toString()) {
  console.error("[linkedin-ads-env] Les callbacks LinkedIn organique et LinkedIn Ads doivent être distincts.");
  process.exit(1);
}

for (const publicSecret of ["NEXT_PUBLIC_LINKEDIN_ADS_CLIENT_SECRET", "NEXT_PUBLIC_INRCY_CREDENTIALS_SECRET"]) {
  if (value(publicSecret)) {
    console.error(`[linkedin-ads-env] Secret exposé au navigateur interdit: ${publicSecret}`);
    process.exit(1);
  }
}

let encryptionKeyBytes = 0;
try {
  encryptionKeyBytes = Buffer.from(value("INRCY_CREDENTIALS_SECRET"), "base64").length;
} catch {
  encryptionKeyBytes = 0;
}
if (encryptionKeyBytes !== 32) {
  console.error("[linkedin-ads-env] INRCY_CREDENTIALS_SECRET doit décoder exactement 32 octets en base64.");
  process.exit(1);
}

const sameApp = value("LINKEDIN_CLIENT_ID") && value("LINKEDIN_CLIENT_ID") === value("LINKEDIN_ADS_CLIENT_ID");
if (sameApp) {
  console.warn("[linkedin-ads-env] La même app LinkedIn est déclarée pour l'organique et Ads. LinkedIn l'autorise si le produit Advertising API est approuvé, mais une app dédiée réduit le périmètre des scopes et des revues.");
}

console.log("[linkedin-ads-env] OK");
console.log(`  App origin: ${appUrl.origin}`);
console.log(`  Ads redirect path: ${redirect.pathname}`);
console.log(`  Marketing API version: ${version}`);
console.log(`  OAuth scopes implemented: ${readScope} (lecture), ${manageScope} (gestion)`);
console.log(`  Credentials: ${sameApp ? "explicit shared LinkedIn app" : "dedicated LinkedIn Ads pair"}`);
