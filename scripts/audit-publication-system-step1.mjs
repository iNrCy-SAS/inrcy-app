import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const sources = {
  imageDecision: read("lib/boosterImageDecision.ts"),
  imageController: read("app/dashboard/booster/publier/usePublishImageController.ts"),
  videoSettings: read("lib/boosterVideoSettings.ts"),
  mediaRules: read("lib/mediaRules.ts"),
  videoPolicy: read("lib/videoPublicationPolicy.ts"),
  asyncPublication: read("lib/boosterAsyncPublication.ts"),
  publicationOutcome: read("lib/boosterPublicationOutcome.ts"),
  publishRoute: read("app/api/booster/publish-now/route.ts"),
  facebookPublish: read("lib/facebookPublish.ts"),
  instagramPublish: read("lib/instagramPublish.ts"),
  imageNormalizer: read("lib/mediaImageNormalizer.ts"),
  imageOutputPolicy: read("lib/boosterImageOutputPolicy.ts"),
};

const criticalChecks = [
  {
    id: "adapter-per-media",
    label: "Adapter conserve une provenance explicite par image",
    ok:
      /customizedImageKeys/.test(sources.imageController) &&
      /isBoosterImageExplicitlyCustomized/.test(sources.imageController) &&
      /manual_customization/.test(sources.imageDecision),
  },
  {
    id: "adapter-apply-all-explicit",
    label: "Appliquer à tous parcourt explicitement chaque média",
    ok:
      /for \(const imageKey of imageKeysForChannel\)/.test(sources.imageController) &&
      /customizedImageKeys\.add\(imageKey\)/.test(sources.imageController),
  },
  {
    id: "original-first",
    label: "Original reste le défaut tant qu'Adapter n'est pas validé",
    ok:
      /customized = false/.test(sources.imageDecision) &&
      /format: "original"/.test(sources.videoSettings),
  },
  {
    id: "no-blur",
    label: "Les anciens réglages floutés sont neutralisés",
    ok:
      /never uses blur/.test(sources.imageDecision) &&
      /safe_blur[\s\S]{0,140}safe_frame/.test(sources.videoSettings),
  },
  {
    id: "source-75mb",
    label: "La source vidéo est plafonnée exactement à 75 000 000 octets",
    ok: /INR_MEDIA_VIDEO_SOURCE_MAX_BYTES = 75_000_000/.test(
      sources.mediaRules,
    ),
  },
  {
    id: "no-automatic-video-compression",
    label: "Le Booster publie l'original accepté sans compression automatique",
    ok:
      /INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES\s*=\s*\n?\s*INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/.test(
        sources.mediaRules,
      ) &&
      !/INR_MEDIA_VIDEO_(?:COMPRESSION_TRIGGER|CANONICAL_(?:TARGET|MAX))_BYTES/.test(
        sources.mediaRules,
      ),
  },
  {
    id: "parallel-fanout",
    label: "La publication reste découpée en un job indépendant par canal",
    ok:
      /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/.test(sources.asyncPublication) &&
      /channelEventIds/.test(sources.publishRoute) &&
      /Promise\.all/.test(sources.publishRoute),
  },
  {
    id: "idempotency",
    label: "Les protections anti-doublon restent actives",
    ok:
      /idempotency/i.test(sources.publishRoute) &&
      /CHANNEL_LOCK_TTL/.test(sources.asyncPublication),
  },
  {
    id: "warning-is-success",
    label: "Un média refusé ne transforme pas un texte publié en échec",
    ok:
      /classifyBoosterPublicationResult/.test(sources.asyncPublication) &&
      /published_with_warning/.test(sources.publicationOutcome) &&
      /entries\.filter\(\(entry\) => !entry\.ok\)/.test(
        sources.asyncPublication,
      ),
  },
];

const plannedWarnings = [
  {
    id: "meta-version-centralization",
    label: "Version Meta encore dispersée",
    present:
      /FACEBOOK_GRAPH_VERSION = "v19\.0"/.test(sources.facebookPublish) ||
      /FACEBOOK_GRAPH_VERSION = "v20\.0"/.test(sources.instagramPublish),
    nextStep: "Étape Meta : constante unique et migration testée.",
  },
  {
    id: "gmb-video-policy",
    label: "Google Business utilise encore la politique vidéo générale",
    present: /gmb: \{ channel: "gmb", \.\.\.DEFAULT_POLICY \}/.test(
      sources.videoPolicy,
    ),
    nextStep: "Étape Google Business : variante dédiée poids/durée/URL.",
  },
  {
    id: "warning-status",
    label: "Le bilan nomme encore un avertissement comme traitement",
    present: /value\.warning\s*\?\s*"processing"/.test(
      sources.asyncPublication,
    ),
    nextStep: "Étape bilan : statut publié avec avertissement.",
  },
  {
    id: "transparent-canonical",
    label: "Le canon image peut encore aplatir une transparence sur blanc",
    present: !/site_web[\s\S]*inr_search/.test(
      sources.imageOutputPolicy,
    ),
    nextStep: "Étape qualité : préserver PNG/WebP alpha sur canaux compatibles.",
  },
];

let failures = 0;
console.log("\n=== iNrCy Publication System - Étape 1 / Base sécurisée ===\n");
for (const check of criticalChecks) {
  if (check.ok) {
    console.log(`PASS  ${check.id} - ${check.label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${check.id} - ${check.label}`);
  }
}

const activeWarnings = plannedWarnings.filter((warning) => warning.present);
console.log("\n--- Correctifs volontairement réservés aux étapes suivantes ---");
for (const warning of activeWarnings) {
  console.log(`WARN  ${warning.id} - ${warning.label}`);
  console.log(`      ${warning.nextStep}`);
}

console.log(
  `\nRésultat : ${criticalChecks.length - failures}/${criticalChecks.length} garde-fous critiques validés, ${activeWarnings.length} chantiers planifiés détectés.`,
);

if (failures > 0) process.exit(1);
