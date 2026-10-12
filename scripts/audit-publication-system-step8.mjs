import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function read(relativePath) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function walk(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

const [
  packageJsonRaw,
  packageLockRaw,
  mediaRules,
  googlePolicy,
  imagePolicy,
  outcomePolicy,
  metaPolicy,
  imagePreparation,
  videoPreparation,
  publishRoute,
  adapterScope,
  historicalOriginalFirstTest,
] = await Promise.all([
  read("package.json"),
  read("package-lock.json"),
  read("lib/mediaRules.ts"),
  read("lib/googleBusinessMediaPolicy.ts"),
  read("lib/boosterImageOutputPolicy.ts"),
  read("lib/boosterPublicationOutcome.ts"),
  read("lib/metaGraphApi.ts"),
  read("lib/boosterImageServerPreparation.ts"),
  read("lib/boosterVideoVariantServer.ts"),
  read("app/api/booster/publish-now/route.ts"),
  read("lib/boosterImageCustomization.ts"),
  read("tests/media-pipeline/media-original-first-architecture.test.mjs"),
]);

const packageJson = JSON.parse(packageJsonRaw);
const packageLock = JSON.parse(packageLockRaw);
const runtimeFiles = (
  await Promise.all(
    ["app", "lib", "hooks"].map(async (directory) =>
      (await walk(directory)).filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file)),
    ),
  )
).flat();
const runtimeText = (
  await Promise.all(runtimeFiles.map(async (file) => `${file}\n${await read(file)}`))
).join("\n");

const requiredStepFiles = [
  "scripts/audit-publication-system-step1.mjs",
  "scripts/audit-publication-system-step2.mjs",
  "scripts/audit-publication-system-step3.mjs",
  "scripts/audit-publication-system-step4.mjs",
  "scripts/audit-publication-system-step5.mjs",
  "scripts/audit-publication-system-step6.mjs",
  "scripts/audit-publication-system-step7.mjs",
  "tests/publication-system/publication-system-step1-baseline.test.mts",
  "tests/publication-system/publication-system-step2-adapter-scope.test.mts",
  "tests/publication-system/publication-system-step3-google-business.test.mts",
  "tests/publication-system/publication-system-step4-video-policy.test.mts",
  "tests/publication-system/publication-system-step5-meta-api.test.mts",
  "tests/publication-system/publication-system-step6-warning-outcomes.test.mts",
  "tests/publication-system/publication-system-step7-quality-performance.test.mts",
];

const checks = [
  {
    name: "source vidéo originale plafonnée à 75 Mo sans compression automatique",
    ok:
      /INR_MEDIA_VIDEO_SOURCE_MAX_BYTES = 75_000_000/.test(mediaRules) &&
      /INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES =\s*\n?\s*INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/.test(
        mediaRules,
      ) &&
      !/INR_MEDIA_VIDEO_(?:COMPRESSION_TRIGGER|CANONICAL_(?:TARGET|MAX))_BYTES/.test(
        mediaRules,
      ),
  },
  {
    name: "politique Google Business 75 Mo / 30 s / 720p sans cible compressée",
    ok:
      /GOOGLE_BUSINESS_VIDEO_OFFICIAL_MAX_BYTES = 75_000_000/.test(
        googlePolicy,
      ) &&
      /GOOGLE_BUSINESS_VIDEO_MAX_BYTES\s*=\s*\n?\s*INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/.test(
        googlePolicy,
      ) &&
      !/GOOGLE_BUSINESS_VIDEO_TARGET_MAX_BYTES|size_requires_compression/.test(
        googlePolicy,
      ) &&
      /GOOGLE_BUSINESS_VIDEO_MAX_DURATION_SECONDS = 30/.test(googlePolicy) &&
      /GOOGLE_BUSINESS_VIDEO_MIN_SHORT_EDGE = 720/.test(googlePolicy) &&
      /action: "block"/.test(googlePolicy),
  },
  {
    name: "Adapter reste isolé par canal et média",
    ok:
      /imageKeys/.test(adapterScope) &&
      /customizedImageKeys/.test(adapterScope) &&
      /selectedSet/.test(adapterScope) &&
      /normalizeBoosterImageCustomizationScope/.test(adapterScope),
  },
  {
    name: "transparence conservée uniquement sur les deux surfaces iNrCy",
    ok:
      /"site_web"/.test(imagePolicy) &&
      /"inr_search"/.test(imagePolicy) &&
      /CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 9/.test(imagePreparation),
  },
  {
    name: "variantes vidéo Google et cache vidéo version 7",
    ok:
      /CHANNEL_VIDEO_VARIANT_PIPELINE_VERSION = 7/.test(videoPreparation) &&
      /GOOGLE_BUSINESS_VIDEO_MAX_DURATION_SECONDS/.test(videoPreparation),
  },
  {
    name: "bilan distingue publié, avertissement, traitement et échec",
    ok:
      /"published_with_warning"/.test(outcomePolicy) &&
      /"processing"/.test(outcomePolicy) &&
      /"failed"/.test(outcomePolicy) &&
      /iNrSend/.test(outcomePolicy),
  },
  {
    name: "publication multi-canaux reste parallèle et anti-blocage",
    ok:
      /Promise\.allSettled/.test(publishRoute) &&
      /channelRows/.test(publishRoute),
  },
  {
    name: "Meta centralisé sans version Graph codée en dur dans le runtime",
    ok:
      /META_GRAPH_API_DEFAULT_VERSION = "v25\.0"/.test(metaPolicy) &&
      !/(?:graph|graph-video)\.facebook\.com\/v\d+\.\d+/i.test(runtimeText) &&
      !/www\.facebook\.com\/v\d+\.\d+/i.test(runtimeText),
  },
  {
    name: "aucun fond flouté dans les préparateurs finaux",
    ok:
      !/\.blur\s*\(/.test(imagePreparation) &&
      !/(?:boxblur|gblur|avgblur|smartblur)/i.test(videoPreparation),
  },
  {
    name: "tests historiques alignés sur les caches image 9 et vidéo 7",
    ok:
      /CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 9/.test(historicalOriginalFirstTest) &&
      /CHANNEL_VIDEO_VARIANT_PIPELINE_VERSION = 7/.test(historicalOriginalFirstTest),
  },
  {
    name: "lockfile et dépendances critiques cohérents",
    ok:
      packageLock.lockfileVersion === 3 &&
      packageJson.dependencies?.next === "^16.2.11" &&
      packageJson.dependencies?.sharp === "0.35.3" &&
      packageLock.packages?.["node_modules/next"]?.version === "16.2.11" &&
      packageLock.packages?.["node_modules/sharp"]?.version === "0.35.3",
  },
  {
    name: "aucun fichier environnement ou secret livré",
    ok:
      !(await exists(".env")) &&
      !(await exists(".env.local")) &&
      !(await exists(".env.production")) &&
      !/(?:sk-proj-|sk_live_|rk_live_|AKIA[0-9A-Z]{16})/.test(runtimeText),
  },
  {
    name: "les sept étapes précédentes restent auditables",
    ok: (await Promise.all(requiredStepFiles.map(exists))).every(Boolean),
  },
];

console.log("\n=== iNrCy Publication System - Étape 8 / Certification finale ===\n");
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}`);
}
const failures = checks.filter((check) => !check.ok);
console.log(
  `\nRésultat : ${checks.length - failures.length}/${checks.length} contrôles finaux validés.`,
);
if (failures.length) process.exitCode = 1;
