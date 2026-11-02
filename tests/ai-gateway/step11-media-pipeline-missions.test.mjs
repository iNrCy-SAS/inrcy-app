import { readVideoNormalizationWorkerSource } from "../media-pipeline/video-worker-sources.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const hookSource = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const modalSource = read(
  "app/dashboard/booster/publier/PublishModal.tsx",
);
const uploadEventSource = read(
  "app/api/media-pipeline/upload-event/route.ts",
);
const uploadIntentSource = read(
  "app/api/media-pipeline/upload-intent/route.ts",
);
const prepareRouteSource = read(
  "app/api/media-pipeline/workspace/prepare/route.ts",
);
const missionSource = read("lib/boosterMediaPipelineMissions.ts");
const sourcePreviewSource = read(
  "app/api/media-pipeline/workspace/source-preview/route.ts",
);
const imageWorkerSource = read("lib/mediaImageNormalizationWorker.ts");
const videoWorkerSource = readVideoNormalizationWorkerSource();

const generationController = read("app/dashboard/booster/publier/useBoosterGeneration.ts");

test("étape 2 expose exactement les trois missions média", () => {
  for (const mission of [
    "source_metadata",
    "ai_preparation",
    "publication_preparation",
  ]) {
    assert.match(missionSource, new RegExp(`"${mission}"`));
  }
  assert.match(
    missionSource,
    /ai_preparation:\s*\["ai_preview"\][\s\S]*publication_preparation:\s*\["canonical"\]/,
  );
  assert.match(
    missionSource,
    /ai_preparation:\s*\[[\s\S]*"thumbnail"[\s\S]*"frame_01"[\s\S]*"audio_track"[\s\S]*publication_preparation:\s*\["canonical", "thumbnail"\]/,
  );
  assert.match(
    missionSource,
    /BOOSTER_VIDEO_PREPARATION_KEYS[\s\S]*"canonical"/,
  );
  assert.doesNotMatch(
    missionSource.slice(missionSource.indexOf("BOOSTER_VIDEO_PREPARATION_KEYS")),
    /"ai_preview"/,
  );
});

test("l'ajout ne lance plus de préparation IA ou publication", () => {
  const scheduleStart = hookSource.indexOf("const scheduleSync");
  const preparationStart = hookSource.indexOf("const runPreparationMission");
  assert.ok(scheduleStart >= 0 && preparationStart > scheduleStart);
  const scheduleSource = hookSource.slice(scheduleStart, preparationStart);
  assert.doesNotMatch(scheduleSource, /prepareMediaPublicationWorkspace\s*\(/);
  assert.doesNotMatch(scheduleSource, /prewarmMediaPublicationWorkspace\s*\(/);
  assert.match(scheduleSource, /buildBoosterSourceMediaMetadata/);
  assert.match(scheduleSource, /source_metadata:\s*sourceMetadata/);
});

test("les deux préparations sont explicites et idempotentes côté client", () => {
  assert.match(hookSource, /prepareAiMedia/);
  assert.match(hookSource, /preparePublicationMedia/);
  assert.match(hookSource, /activePreparationRef/);
  assert.match(hookSource, /missionReadyRef/);
});

test("la vidéo n'est plus analysée au moment de son ajout et Générer ne lance aucune préparation lourde", () => {
  const addStart = modalSource.indexOf("const addVideoFile");
  const addEnd = modalSource.indexOf("const onVideoChange", addStart);
  assert.ok(addStart >= 0 && addEnd > addStart);
  const addSource = modalSource.slice(addStart, addEnd);
  assert.doesNotMatch(addSource, /getOrPrepareVideoFramesForAI/);
  assert.doesNotMatch(addSource, /getOrPrepareVideoAudioFileForAI/);

  const readinessStart = modalSource.indexOf(
    "const waitForPersistentWorkspaceReadiness",
  );
  const readinessEnd = modalSource.indexOf(
    "const resolveChannelMediaMode",
    readinessStart,
  );
  assert.ok(readinessStart >= 0 && readinessEnd > readinessStart);
  const readinessSource = modalSource.slice(readinessStart, readinessEnd);
  assert.match(readinessSource, /await waitForPersistentWorkspaceIdle/);
  assert.match(readinessSource, /await verifyPersistentWorkspaceSources/);
  assert.doesNotMatch(readinessSource, /preparePersistent/);
  assert.doesNotMatch([modalSource, generationController].join("\n"), /preparePersistentAiMedia/);
  assert.doesNotMatch([modalSource, generationController].join("\n"), /preparePersistentPublicationMedia/);
  assert.match(
    generationController,
    /await waitForPersistentWorkspaceReadiness\(\s*"generate"/,
  );
  assert.match(generationController, /Date\.now\(\) \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/);
  assert.match(
    generationController,
    /BOOSTER_GENERATION_SAFETY_BUDGET_MS\s*=\s*105_000/,
  );
});

test("l'upload workspace persiste les métadonnées puis préchauffe les dérivées hors du chemin critique", () => {
  assert.match(uploadIntentSource, /width:\s*sourceRegistry\.width/);
  assert.match(uploadIntentSource, /height:\s*sourceRegistry\.height/);
  assert.match(
    uploadIntentSource,
    /duration_seconds:\s*sourceRegistry\.durationSeconds/,
  );
  assert.doesNotMatch(
    uploadIntentSource,
    /reused image normalization enqueue failed/,
  );
  assert.match(uploadEventSource, /sourceMetadataOnly/);
  assert.match(
    uploadEventSource,
    /mission:\s*sourceMetadataOnly\s*\?\s*"publication_preparation"/,
  );

  const imageBlockStart = uploadEventSource.indexOf(
    'current.data.media_type === "image"',
  );
  const videoBlockStart = uploadEventSource.indexOf(
    'current.data.media_type === "video" &&',
    imageBlockStart,
  );
  const responseStart = uploadEventSource.indexOf(
    "await refreshPublicationWorkspaceStatusesForMedia",
    videoBlockStart,
  );
  assert.ok(
    imageBlockStart >= 0 &&
      videoBlockStart > imageBlockStart &&
      responseStart > videoBlockStart,
  );
  const imageBlock = uploadEventSource.slice(imageBlockStart, videoBlockStart);
  const videoBlock = uploadEventSource.slice(videoBlockStart, responseStart);
  assert.match(imageBlock, /await enqueueImageNormalization\(/);
  assert.match(
    imageBlock,
    /after\(async \(\) => \{[\s\S]*await processImageNormalizationJobsForMedia\(/,
  );
  assert.match(videoBlock, /await enqueueVideoNormalization\(/);
  assert.match(
    videoBlock,
    /processVideoNormalizationAfterUpload\(\{/,
  );
  assert.match(
    uploadEventSource,
    /function processVideoNormalizationAfterUpload[\s\S]*after\(async \(\) => \{[\s\S]*await processVideoNormalizationJobsForMedia\(/,
  );
});

test("le serveur distingue préparation IA et préparation publication", () => {
  assert.match(prepareRouteSource, /type PreparationMission/);
  assert.match(prepareRouteSource, /mission === "ai_preparation"/);
  assert.match(prepareRouteSource, /canUseOriginalVideo/);
  assert.match(prepareRouteSource, /hasAiArtifacts/);
  assert.match(prepareRouteSource, /mission,/);
  assert.match(prepareRouteSource, /alignReadyMissionStatuses/);
  assert.match(imageWorkerSource, /requiredImagePurposes/);
  assert.match(videoWorkerSource, /requiredVideoKeys/);
});

test("la miniature d'interface reste une mission source sans canonique", () => {
  assert.match(sourcePreviewSource, /normalizeImageThumbnailBuffer/);
  assert.match(sourcePreviewSource, /mission:\s*"source_metadata"/);
  assert.match(sourcePreviewSource, /interface_only:\s*true/);
  assert.doesNotMatch(sourcePreviewSource, /purpose:\s*"canonical"/);
  assert.doesNotMatch(sourcePreviewSource, /purpose:\s*"ai_preview"/);
});
