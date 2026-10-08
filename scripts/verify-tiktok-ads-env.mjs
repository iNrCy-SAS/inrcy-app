/*
 * Vérification TikTok Marketing API. Aucune clé, aucun jeton ni URL d’autorisation n’est journalisé.
 * Usage : node --experimental-strip-types scripts/verify-tiktok-ads-env.mjs
 */
import { validateTikTokAdsEnv } from "./verify-tiktok-ads-env-core.mjs";

const result = validateTikTokAdsEnv(process.env);
if (!result.ok) {
  console.error("[tiktok-ads-env] Configuration invalide :");
  for (const error of result.errors) console.error("  - " + error);
  process.exit(1);
}
console.log("[tiktok-ads-env] OK : application et callback OAuth cohérents, stockage chiffré.");
for (const warning of result.warnings) console.warn("  - " + warning);
