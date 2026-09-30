/*
 * Vérification de la configuration LinkedIn Ads iNrCy.
 * Ne journalise jamais les identifiants ni les secrets.
 */

import { validateLinkedInAdsEnv } from "./verify-linkedin-ads-env-core.mjs";

const result = validateLinkedInAdsEnv(process.env);
if (!result.ok) {
  console.error("[linkedin-ads-env] Configuration invalide:");
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}
for (const warning of result.warnings) console.warn(`[linkedin-ads-env] ${warning}`);

console.log("[linkedin-ads-env] OK");
console.log(`  App origin: ${result.details.appOrigin}`);
console.log(`  Ads redirect path: ${result.details.redirectPath}`);
console.log(`  Marketing API version: ${result.details.version}`);
console.log(`  OAuth read-only scope: ${result.details.readScope}`);
console.log(`  OAuth manage scopes: ${result.details.manageScopes.join(" ")}`);
console.log(`  Development-mapped accounts: ${result.details.developmentAccountIds.join(", ")}`);
console.log(`  LinkedIn publisher gate: ${result.details.publicationEnabled ? "enabled" : "locked"}`);
console.log(`  Credentials: ${result.details.credentialLabel}`);
