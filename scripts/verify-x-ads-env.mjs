/*
 * Vérification de la configuration X Ads iNrCy.
 * Ne journalise jamais les API keys, secrets ni jetons OAuth.
 */

import { validateXAdsEnv } from "./verify-x-ads-env-core.mjs";

const result = validateXAdsEnv(process.env);
if (!result.ok) {
  console.error("[x-ads-env] Configuration invalide:");
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("[x-ads-env] OK");
console.log(`  App origin: ${result.details.appOrigin}`);
console.log(`  Ads redirect path: ${result.details.redirectPath}`);
console.log(`  Ads API version: ${result.details.version}`);
console.log("  Authentication: OAuth 1.0a, user context, credentials server-only");
console.log("  Organic X isolation: dedicated callback, variables and integration row");
console.log("  Portal check: the same Ads callback must also be registered in X Developer Console");
