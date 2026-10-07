import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("la confirmation finale d'upload est obligatoire et rejouée", () => {
  const source = read("lib/universalMediaUploadClient.ts");
  assert.match(source, /required\?: boolean/);
  assert.match(source, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(source, /event: "uploaded"[\s\S]{0,180}required: true/);
  assert.match(source, /Impossible de confirmer l’envoi du média/);
});

test("le polling de statut ne régénère pas des URLs signées à chaque passage", () => {
  const client = read("lib/mediaWorkspaceClient.ts");
  const route = read("app/api/media-pipeline/workspace/route.ts");
  const hook = read("app/dashboard/booster/publier/usePersistentMediaWorkspace.ts");
  assert.match(client, /includeUrls\?: boolean/);
  assert.match(client, /includeUrls: params\.includeUrls === false \? "0" : "1"/);
  assert.match(route, /const includeUrls = url\.searchParams\.get\("includeUrls"\) !== "0"/);
  assert.match(route, /includeUrls && !recovery.requiresCanonical && bucket && storagePath/);
  assert.match(hook, /includeUrls: false/);
});

test("Générer vérifie les sources sans déclencher la préparation lourde du workspace", () => {
  const route = read("app/api/media-pipeline/workspace/prepare/route.ts");
  const client = read("lib/mediaWorkspaceClient.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const vercel = JSON.parse(read("vercel.json"));

  assert.match(route, /requireUser\(\)/);
  assert.match(route, /enqueueImageNormalization\(/);
  assert.match(route, /enqueueVideoNormalization\(/);
  assert.match(route, /processImageNormalizationJobsForMedia\(/);
  assert.match(route, /processVideoNormalizationJobsForMedia\(/);
  assert.match(route, /priority: 10_000/);
  assert.match(client, /\/api\/media-pipeline\/workspace\/prepare/);
  assert.match(modal, /await waitForPersistentWorkspaceIdle/);
  assert.match(modal, /await verifyPersistentWorkspaceSources/);
  assert.doesNotMatch(modal, /preparePersistentAiMedia/);
  assert.doesNotMatch(modal, /preparePersistentPublicationMedia/);
  assert.doesNotMatch(modal, /prepareMediaPublicationWorkspace\(/);
  const hook = read(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );
  assert.match(hook, /prepareMediaPublicationWorkspace\(\{[\s\S]*mission,/);
  assert.match(
    vercel.functions["app/api/media-pipeline/workspace/prepare/route.ts"]
      .includeFiles,
    /ffmpeg-static/,
  );
});

test("le rattrapage reconnaît un fichier déjà présent dans Storage", () => {
  const source = read("app/api/media-pipeline/workspace/prepare/route.ts");
  assert.match(source, /repairCompletedStorageUploads/);
  assert.match(source, /storedSize !== item\.sizeBytes/);
  assert.match(source, /upload_status: "uploaded"/);
});

test("la préparation vidéo cible le média du workspace au lieu d'un job arbitraire", () => {
  const route = read("app/api/media-pipeline/workspace/prepare/route.ts");
  const worker = read("lib/mediaVideoNormalizationWorker.ts");
  const targetedClaim = read("lib/mediaProcessingTargetedClaim.ts");

  assert.match(
    route,
    /const mediaIds = pendingVideos\.map\(\(item\) => item\.mediaId\)/,
  );
  assert.match(route, /processVideoNormalizationJobsForMedia\(\{/);
  assert.match(
    route,
    /after\(async \(\) => \{[\s\S]*processVideoNormalizationJobsForMedia\(\{[\s\S]*mediaIds,/,
  );
  assert.match(worker, /claimTargetedProcessingJob\(/);
  assert.match(worker, /jobType: VIDEO_NORMALIZATION_JOB_TYPE/);
  assert.match(targetedClaim, /\.eq\("media_id", mediaId\)/);
  assert.match(targetedClaim, /\.eq\("job_type", jobType\)/);
});
