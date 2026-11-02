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

const generationController = read("app/dashboard/booster/publier/useBoosterGeneration.ts");

test("la migration étape 8 est additive et prépare les lectures de publication", () => {
  const sql = read("ops/sql/2026-07-29_media_pipeline_step8_legacy_cutover.sql");
  const verify = read("ops/sql/2026-07-29_media_pipeline_step8_verify.sql");
  assert.match(sql, /^begin;/m);
  assert.match(sql, /media_variants_channel_publish_lookup_idx/);
  assert.match(sql, /publication_workspaces_cutover_lifecycle_idx/);
  assert.match(sql, /where status = 'ready' and purpose = 'channel_publish'/);
  assert.doesNotMatch(
    sql,
    /\bdrop\s+(table|column|function|index)\b|\btruncate\b|\bdelete\s+from\b/i,
  );
  assert.doesNotMatch(verify, /\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\btruncate\b/i);
});

test("Générer accepte les deux familles IA et continue sans bloquer sur le média", () => {
  const generate = read("app/api/booster/generate/route.ts");
  assert.match(generate, /mediaPipelineCutoverV1\?: boolean/);
  assert.match(generate, /isLegacyMediaTransportCutoverEnabled\(\)/);
  assert.match(generate, /imagesForAI:\s*\[\]/);
  assert.match(
    generate,
    /videoForAI:\s*mediaType === "video" \? body\.videoForAI : null/,
  );
  assert.match(generate, /allowMixedMedia:\s*true/);
  assert.match(generate, /mediaWorkspaceExpected\?: boolean/);
  assert.match(
    generate,
    /strictMediaCutover\s*&&\s*mediaWorkspaceExpected\s*&&\s*\(!useWorkspaceMediaForAI \|\| !mediaWorkspaceId\)/,
  );
  assert.match(
    generate,
    /buildMediaAnalysisFallback\(\s*"media_workspace_required",\s*"media"/,
  );
  assert.match(generate, /workspace missing, text fallback/);
  assert.match(generate, /workspaceError instanceof MediaWorkspaceConsumptionError/);
  assert.match(generate, /workspace_cutover_v1/);
  assert.match(generate, /workspace_media_mismatch/);
  assert.match(generate, /mediaWorkspaceSource = "legacy_fallback"/);
});

test("Publier recrée images et vidéos côté serveur depuis le workspace", () => {
  const publish = read("app/api/booster/publish-now/route.ts");
  const imageServer = read("lib/boosterImageServerPreparation.ts");
  const videoServer = read("lib/boosterVideoVariantServer.ts");
  assert.match(publish, /prepareBoosterImagesByChannelOnServer\(/);
  assert.match(publish, /prepareBoosterVideoVariantsOnServer\(/);
  assert.match(
    publish,
    /const legacyVideoResult = hasAnyVideoChannel && !strictMediaCutover/,
  );
  assert.doesNotMatch(publish, /hasVideoFallbackPayload/);
  assert.match(publish, /code:\s*"media_workspace_required"/);
  assert.match(publish, /workspace_media_mismatch/);
  assert.match(publish, /workspace_image_preparation_failed/);
  assert.match(publish, /workspace_video_preparation_pending/);
  assert.match(imageServer, /supabaseAdmin\.storage\.from\(bucket\)\.download\(storagePath\)/);
  assert.match(imageServer, /settingsByChannel/);
  assert.match(imageServer, /sharp\(params\.buffer/);
  assert.match(videoServer, /async function resolveSourceDownloadUrl\(/);
  assert.match(
    videoServer,
    /createSafeStorageSignedUrl\(\s*bucket,\s*storagePath/,
  );
  assert.match(videoServer, /const response = await fetch\(resolved\.downloadUrl/);
  assert.match(videoServer, /await pipeline\([\s\S]*createWriteStream\(inputPath/);
  assert.doesNotMatch(
    videoServer,
    /\.download\(storagePath\)|await\s+[^;\n]+\.arrayBuffer\(\)/,
  );
  assert.match(videoServer, /ffmpeg-static/);
  assert.match(videoServer, /buildVideoTransformPlan/);
});

test("Booster n'envoie plus de médias historiques quand le cutover client est actif", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const controller = read("app/dashboard/booster/publier/usePublishImageController.ts");
  assert.match(modal, /isLegacyMediaTransportCutoverClientEnabled/);
  assert.match(modal, /const mediaPipelineCutoverEnabled = legacyMediaCutoverClientAvailable/);
  assert.match(submission, /mediaPipelineCutoverV1:\s*mediaPipelineCutoverEnabled/);
  assert.match(
    generationController,
    /mediaWorkspaceExpected:[\s\S]*shouldUsePersistentMediaWorkspaceForAi[\s\S]*Boolean\(readyMediaWorkspaceId\)/,
  );
  assert.match(
    generationController,
    /useWorkspaceMediaForAI:[\s\S]*shouldUsePersistentMediaWorkspaceForAi/,
  );
  assert.match(generationController, /imagesForAI:\s*mediaPipelineCutoverEnabled \? \[\] : imagesForAI/);
  assert.match(submission, /shouldBuildImageFallbackPayload/);
  assert.match(submission, /shouldBuildVideoFallbackPayload/);
  assert.match(submission, /workspaceCarriesImagesForPublish/);
  assert.match(submission, /workspaceCarriesVideoForPublish/);
  assert.match(submission, /channelSettings:\s*buildChannelImageSettingsPayload\(\)/);
  assert.match(controller, /buildChannelImageSettingsPayload/);
  assert.doesNotMatch(controller, /buildChannelImageSettingsPayload[\s\S]{0,250}uploadPreparedImages/);
});

test("les brouillons réutilisent le workspace sans upload doublon", () => {
  const workspaceRoute = read("app/api/media-pipeline/workspace/route.ts");
  const client = read("lib/mediaWorkspaceClient.ts");
  assert.match(draftSession, /loadMediaPublicationWorkspace\(/);
  assert.match(draftSession, /mediaPipelineCutoverEnabled && mediaWorkspaceId/);
  assert.match(draftSession, /\? await uploadPublicationDraftImages\(\)/);
  assert.match(draftSession, /\? null\s*:\s*await buildPublicationDraftVideoPayload\(\)/);
  assert.match(workspaceRoute, /createSafeStorageSignedUrl/);
  assert.match(workspaceRoute, /client_media_key/);
  assert.match(workspaceRoute, /publicUrl/);
  assert.match(client, /loadMediaPublicationWorkspace/);
});

test("la route vidéo historique réutilise le même moteur serveur", () => {
  const route = read("app/api/booster/video-transform/route.ts");
  const transforms = read("lib/boosterVideoTransforms.ts");
  assert.match(route, /prepareBoosterVideoVariantsOnServer\(/);
  assert.match(transforms, /bucket\?: string \| null/);
  assert.doesNotMatch(route, /execFileAsync|mkdtemp|readFile\(/);
});

test("le registre conserve la clé média d'origine et marque l'étape 8", () => {
  const resolver = read("lib/mediaWorkspaceConsumption.ts");
  assert.match(resolver, /client_media_key/);
  assert.match(resolver, /editorImageKeyFromClientMediaKey/);
  assert.match(resolver, /media_pipeline_step:\s*8/);
  assert.match(resolver, /sourceMetadata/);
});

test("le retrait reste réversible par flags sans supprimer les anciennes routes", () => {
  const policy = read("lib/mediaPipelineLegacyCutoverPolicy.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const publish = read("app/api/booster/publish-now/route.ts");
  assert.match(policy, /MEDIA_PIPELINE_LEGACY_CUTOVER_V1/);
  assert.match(policy, /NEXT_PUBLIC_MEDIA_PIPELINE_LEGACY_CUTOVER_V1/);
  assert.match(submission, /uploadPreparedImages/);
  assert.match(modal, /uploadPublicationVideoForPublish/);
  assert.match(publish, /normalizeVideoPayload\(body\.video\)/);
  assert.match(publish, /!strictMediaCutover/);
});
