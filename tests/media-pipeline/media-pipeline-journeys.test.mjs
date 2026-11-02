import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import { readFileSync as readDraftSessionSource } from "node:fs";
const draftSession = readDraftSessionSource(new URL("../../app/dashboard/booster/publier/publicationDraftSession.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

const imageController = () =>
  read("app/dashboard/booster/publier/usePublishImageController.ts");
const videoController = () =>
  read("app/dashboard/booster/publier/usePublishVideoController.ts");
const modal = () => read("app/dashboard/booster/publier/PublishModal.tsx");
const shared = () =>
  read("app/dashboard/booster/publier/publishModal.shared.tsx");

const generationController = read("app/dashboard/booster/publier/useBoosterGeneration.ts");

test("insertion image : la source part directement au workspace sans conversion Vercel", () => {
  assert.doesNotMatch(imageController(), /convertHeicOrHeifImageFile/);
  assert.doesNotMatch(shared(), /\/api\/booster\/convert-image/);
  assert.equal(
    existsSync(resolve(ROOT, "app/api/booster/convert-image/route.ts")),
    false,
  );
  assert.match(imageController(), /buildLocalImagePresentation/);
  assert.match(imageController(), /syncPersistentWorkspaceImages/);
  assert.match(imageController(), /async function uploadPublicationDraftImages\(\)/);
  assert.match(imageController(), /uploadBoosterImageFileDirect\(/);
  assert.match(shared(), /fetch\("\/api\/booster\/upload-prepared"/);
  assert.match(imageController(), /const uploadOriginalImagesForPublication\s*=\s*async/);
  assert.match(shared(), /export async function uploadPreparedImages\(/);
});

test("baseline génération : les médias IA sont préparés avant /api/booster/generate", () => {
  const source = generationController;
  assert.match(source, /getOrPrepareAiImagePayload/);
  assert.match(source, /getOrPrepareVideoFramesForAI/);
  assert.match(generationController, /buildBoosterGenerationRequest/);
  assert.match(generationController, /fetch\("\/api\/booster\/generate"/);
  assert.match(
    read("lib/boosterGenerationTransportClient.ts"),
    /transport:\s*"multipart"/,
  );
});

test("baseline publication immédiate prépare les médias avant trackEvent publish", () => {
  const source = submission;
  const uploadImageIndex = source.indexOf("uploadOriginalImagesForPublication(");
  const uploadVideoIndex = source.indexOf("uploadPublicationVideoForPublish()");
  const publishIndex = source.indexOf('trackEvent("publish"');
  assert.ok(uploadImageIndex >= 0 && uploadImageIndex < publishIndex);
  assert.ok(uploadVideoIndex >= 0 && uploadVideoIndex < publishIndex);
  assert.match(submission, /preparePublicationVideoVariants\(/);
});

test("baseline programmation prépare les mêmes médias avant scheduled-actions", () => {
  const source = submission;
  const scheduleIndex = source.indexOf("postBoosterScheduledAction(");
  assert.ok(scheduleIndex >= 0, "La route de programmation doit exister");
  const beforeSchedule = source.slice(Math.max(0, scheduleIndex - 16000), scheduleIndex);
  assert.match(beforeSchedule, /buildChannelImagesPayload\(/);
  assert.match(beforeSchedule, /uploadOriginalImagesForPublication\(/);
  assert.match(beforeSchedule, /uploadPreparedImages\(/);
  assert.match(beforeSchedule, /uploadPublicationVideoForPublish\(\)/);
});

test("baseline brouillon persiste puis restaure images et vidéo", () => {
  assert.match(draftSession, /uploadPublicationDraftImages\(\)/);
  assert.match(draftSession, /buildPublicationDraftVideoPayload\(\)/);
  assert.match(imageController(), /restorePublicationDraftImages/);
  assert.match(videoController(), /normalizeRestoredVideoVariants/);
});

test("ajouter un média reste indépendant d'une régénération automatique", () => {
  const imageSource = imageController();
  const videoSource = modal().slice(
    modal().indexOf("const addVideoFile"),
    modal().indexOf("const onVideoChange"),
  );
  assert.doesNotMatch(imageSource.slice(imageSource.indexOf("const addImageFiles"), imageSource.indexOf("const onImagesChange")), /\/api\/booster\/generate/);
  assert.doesNotMatch(videoSource, /\/api\/booster\/generate/);
});
