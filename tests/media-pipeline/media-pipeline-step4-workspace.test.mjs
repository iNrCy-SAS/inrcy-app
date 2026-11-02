import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import { readFileSync as readDraftSessionSource } from "node:fs";
const draftSession = readDraftSessionSource(new URL("../../app/dashboard/booster/publier/publicationDraftSession.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("l'étape 4 reste désactivable indépendamment du transport étape 3", () => {
  const source = read("lib/mediaWorkspaceClient.ts");
  assert.match(source, /isUniversalMediaUploadEnabled\(\)/);
  assert.match(source, /NEXT_PUBLIC_MEDIA_PIPELINE_WORKSPACE_V1/);
  assert.match(source, /window\.sessionStorage/);
});

test("la route workspace est scoped établissement et ne transporte aucun binaire", () => {
  const source = read("app/api/media-pipeline/workspace/route.ts");
  assert.match(source, /requireUser\(\)/);
  assert.match(source, /\.eq\("account_id", activeUserId\)/);
  assert.match(source, /publication_workspace_media/);
  assert.doesNotMatch(source, /\.formData\s*\(/);
  assert.doesNotMatch(source, /\.arrayBuffer\s*\(/);
  assert.doesNotMatch(source, /Buffer\.from\s*\(/);
});

test("l'intent workspace exige un workspace et une position avant la liaison", () => {
  const source = read("app/api/media-pipeline/upload-intent/route.ts");
  assert.match(source, /target === "workspace_source"/);
  assert.match(source, /workspace_required/);
  assert.match(source, /workspace_position_invalid/);
  assert.match(source, /attachRegisteredMediaToWorkspace/);
  assert.match(source, /publication_workspace_media/);
});

test("les images et vidéos déclenchent la persistance dès insertion", () => {
  const image = read(
    "app/dashboard/booster/publier/usePublishImageController.ts",
  );
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const hook = read(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );
  const missions = read("lib/boosterMediaPipelineMissions.ts");

  const imageAddBlock = image.slice(
    image.indexOf("const addImageFiles"),
    image.indexOf("const onImagesChange"),
  );
  assert.match(
    imageAddBlock,
    /syncPersistentWorkspaceImages\?\.\([\s\S]*nextFiles[\s\S]*source_metadata/,
  );
  assert.doesNotMatch(imageAddBlock, /\/api\/booster\/generate/);

  const videoAddBlock = modal.slice(
    modal.indexOf("const addVideoFile"),
    modal.indexOf("const onVideoChange"),
  );
  assert.match(videoAddBlock, /syncPersistentWorkspaceVideo\(normalizedFile/);
  assert.doesNotMatch(videoAddBlock, /\/api\/booster\/generate/);

  assert.match(hook, /target:\s*"workspace_source"/);
  assert.match(hook, /workspacePosition:\s*position/);
  assert.match(hook, /persistProgress:\s*false/);
  assert.match(hook, /buildBoosterSourceMediaMetadata\(/);
  assert.match(missions, /pipeline_mission:\s*"source_metadata"/);
  assert.match(missions, /preparation_scope:\s*"source_only"/);
  assert.doesNotMatch(hook, /queueBackgroundPreparation/);
});


test("le statut workspace suit la fin réelle des uploads", () => {
  const server = read("lib/mediaWorkspaceServer.ts");
  const event = read("app/api/media-pipeline/upload-event/route.ts");
  const intent = read("app/api/media-pipeline/upload-intent/route.ts");
  assert.match(server, /allUploadsReady/);
  assert.match(server, /status\.uploadStatus === "uploaded"/);
  assert.match(server, /status\.uploadStatus === "failed" \|\| status\.uploadStatus === "removed"/);
  assert.match(event, /refreshPublicationWorkspaceStatusesForMedia/);
  assert.match(intent, /refreshPublicationWorkspaceMediaStatus/);
});

test("les brouillons conservent la référence et la publication archive le workspace", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  assert.match(modal, /mediaWorkspaceId,/);
  assert.match(modal, /mediaWorkspaceClientKey,/);
  assert.match(draftSession, /adoptMediaWorkspace\(/);
  assert.match(draftSession, /linkPersistentWorkspaceDraft\(savedDraftId\)/);
  assert.match(submission, /archivePersistentMediaWorkspace\(\)/);
});

test("l'ancien pipeline reste présent pour publier et programmer", () => {
  const shared = read(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
  );
  assert.match(submission, /uploadOriginalImagesForPublication\(/);
  assert.match(submission, /uploadPublicationVideoForPublish\(\)/);
  assert.match(shared, /universal image upload fallback/);
  assert.match(shared, /universal video upload fallback/);
});
