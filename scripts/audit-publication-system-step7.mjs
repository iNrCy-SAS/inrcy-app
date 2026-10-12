import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const outputPolicy = read("lib/boosterImageOutputPolicy.ts");
const preparation = read("lib/boosterImageServerPreparation.ts");
const facebook = read("lib/facebookPublish.ts");
const immediate = read("app/api/booster/publish-now/route.ts");
const inrSend = read("lib/inrsend/publicationChannelActions.ts");

const checks = [
  [/site_web/.test(outputPolicy) && /inr_search/.test(outputPolicy), "transparence réservée aux deux surfaces compatibles"],
  [/CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 9/.test(preparation), "cache des anciennes variantes blanches invalidé"],
  [/"Originale" is reference-only/.test(preparation) && !/renderPublicationOriginal/.test(preparation), "chemin original sans rendu ni variante par canal"],
  [/FACEBOOK_IMAGE_UPLOAD_CONCURRENCY = 2/.test(facebook), "concurrence Facebook limitée à deux images"],
  [/mapWithConcurrency/.test(facebook), "ordre Facebook préservé malgré le parallélisme"],
  [/published_with_partial_images/.test(immediate) && /published_with_partial_images/.test(inrSend), "carrousel Facebook partiel signalé"],
  [!/published_without_video/.test(immediate) && /fallbackResp/.test(immediate), "échec vidéo conservé côté publication immédiate"],
  [!/published_without_video/.test(inrSend) && /fallbackResp/.test(inrSend), "échec vidéo conservé dans iNrSend"],
  [!/\.blur\(/.test(preparation), "aucun rendu flouté"],
];

let failures = 0;
console.log("\n=== iNrCy Publication System - Étape 7 / Qualité et performances ===\n");
for (const [ok, label] of checks) {
  if (ok) console.log(`PASS  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}
console.log(`\nRésultat : ${checks.length - failures}/${checks.length} contrôles validés.`);
if (failures) process.exit(1);
