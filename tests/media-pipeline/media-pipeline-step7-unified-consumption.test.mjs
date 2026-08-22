import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("la migration étape 7 est additive et optimise seulement les lectures", () => {
  const sql = read(
    "ops/sql/2026-07-29_media_pipeline_step7_unified_consumption.sql",
  );
  const verify = read(
    "ops/sql/2026-07-29_media_pipeline_step7_verify.sql",
  );
  assert.match(sql, /^begin;/m);
  assert.match(sql, /media_variants_ready_consumption_idx/);
  assert.match(sql, /publication_workspace_media_workspace_position_media_idx/);
  assert.match(sql, /publication_workspaces_account_lifecycle_idx/);
  assert.match(sql, /where status = 'ready'/);
  assert.doesNotMatch(
    sql,
    /\bdrop\s+(table|column|function|index)\b|\btruncate\b|\bdelete\s+from\b/i,
  );
  assert.doesNotMatch(verify, /\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\btruncate\b/i);
});

test("le résolveur relit le workspace dans le scope établissement et dans son ordre", () => {
  const source = read("lib/mediaWorkspaceConsumption.ts");
  assert.match(source, /eq\("account_id", params\.accountId\)/);
  assert.match(source, /eq\("pro_media_library\.user_id", params\.accountId\)/);
  assert.match(source, /order\("position", \{ ascending: true \}\)/);
  assert.match(source, /item\.uploadStatus !== "uploaded"/);
  assert.match(source, /const uploadedVideoIsUsable/);
  assert.match(source, /canPublishVideoSourceDirectly\(/);
  assert.match(source, /item\.processingStatus !== "ready"/);
  assert.match(source, /\["ready", "legacy_ready"\]\.includes\(item\.publicationStatus\)/);
  assert.match(source, /eq\("status", "ready"\)/);
});

test("Générer consomme les aperçus IA, captures et audio avec secours historique", () => {
  const resolver = read("lib/mediaWorkspaceConsumption.ts");
  const generate = read("app/api/booster/generate/route.ts");
  assert.match(resolver, /"ai_preview"/);
  assert.match(resolver, /\["frame_01", "frame_02", "frame_03"\] as const/);
  assert.match(resolver, /getVideoNormalizationSignature\(key\)/);
  assert.match(resolver, /"audio_track"/);
  assert.match(resolver, /MAX_AI_IMAGE_COUNT = 5/);
  assert.match(generate, /resolveWorkspaceAiConsumption\(/);
  assert.match(generate, /aiTranscribeMedia\(/);
  assert.match(generate, /workspace_cutover_v1/);
  assert.match(generate, /strictMediaCutover/);
  assert.match(generate, /mediaWorkspaceSource = "legacy_fallback"/);
  assert.match(generate, /sanitizeImagesForAI/);
  assert.match(generate, /sanitizeVideoFramesForAI/);
});

test("Publier préfère le canonique privé tout en conservant les variantes historiques", () => {
  const resolver = read("lib/mediaWorkspaceConsumption.ts");
  const publish =
    read("app/api/booster/publish-now/route.ts") +
    read("app/api/booster/publish-now/publishNow.server-preparation.ts");
  assert.match(resolver, /pickReadyVariant\([\s\S]*"canonical"/);
  assert.match(resolver, /bucket: canonical\.bucket/);
  assert.match(resolver, /canonicalImageName\(/);
  assert.match(resolver, /canonicalVideoName\(/);
  assert.match(publish, /resolveWorkspacePublicationConsumption\(/);
  assert.match(publish, /workspaceConsumption\.images/);
  assert.match(publish, /workspaceConsumption\.video/);
  assert.match(publish, /legacyVideoResult\.video\?\.transformedVariants/);
  assert.match(publish, /const bucket = String\(img\.bucket \|\| "booster"\)/);
  assert.match(publish, /buildUrlsFromStoragePath\(img\.storagePath, bucket\)/);
  assert.match(publish, /buildUrlsFromStoragePath\(\s*thumbnailStoragePath,\s*thumbnailBucket/);
  assert.match(publish, /workspaceVideoResult\.video\.thumbnailUrl/);
  assert.match(publish, /needsPublicationCopy =\s*!source\.storagePath \|\| source\.bucket !== "booster"/);
});

test("Booster joint le workspace aux trois actions sans retirer l'ancien filet", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  assert.match(modal, /isUnifiedMediaConsumptionClientEnabled/);
  assert.match(modal, /const generationPayload = \{[\s\S]*mediaWorkspaceId:/);
  assert.match(modal, /trackEvent\("publish", \{[\s\S]*mediaWorkspaceId:/);
  assert.match(modal, /publishPayload: \{[\s\S]*mediaWorkspaceId:/);
  assert.match(modal, /uploadPreparedImages/);
  assert.match(modal, /uploadPublicationVideoForPublish/);
  assert.match(modal, /preparePublicationVideoVariants/);
});

test("Programmer persiste le cycle scheduled et l'exécution repasse par publish-now", () => {
  const scheduled = read("app/api/agent/scheduled-actions/route.ts");
  const cron = read("app/api/cron/inr-agent-scheduled-actions/route.ts");
  const durableRequest = read("lib/inrAgentScheduledPublication.ts");
  assert.match(scheduled, /publishPayload\.mediaWorkspaceId/);
  assert.match(scheduled, /syncPublicationWorkspaceContext\(/);
  assert.match(scheduled, /operation: "schedule"/);
  assert.match(scheduled, /status: "scheduled"/);
  assert.match(scheduled, /scheduledFor: scheduledAt/);
  assert.match(cron, /buildScheduledPublicationRequest\(row\)/);
  assert.match(durableRequest, /body:\s*\{[\s\S]{0,80}\.\.\.publishPayload/);
  assert.match(cron, /\/api\/booster\/publish-now/);
});

test("le workspace suit generate, publishing, published et failed", () => {
  const workspace = read("lib/mediaWorkspaceConsumption.ts");
  const generate = read("app/api/booster/generate/route.ts");
  const publish = read("app/api/booster/publish-now/route.ts");
  assert.match(workspace, /operation: "generate" \| "publish" \| "schedule"/);
  assert.match(workspace, /media_pipeline_step: (7|8)/);
  assert.match(generate, /operation: "generate"/);
  assert.match(generate, /status: "ready"/);
  assert.match(publish, /syncMediaWorkspaceLifecycle\("publishing"/);
  assert.match(publish, /syncMediaWorkspaceLifecycle\("published"/);
  assert.match(publish, /syncMediaWorkspaceLifecycle\("failed"/);
});

test("TikTok relit les vidéos dans leur bucket réel et garde le proxy booster", () => {
  const publish = read("app/api/booster/publish-now/route.ts");
  assert.match(publish, /function createTikTokStorageRangeSource\(/);
  assert.match(publish, /const bucket = String\(video\.bucket \|\| "booster"\)/);
  assert.match(publish, /\.from\(bucket\)\.getPublicUrl\(storagePath\)/);
  assert.match(
    publish,
    /createSafeStorageSignedUrl\(\s*bucket,\s*storagePath,\s*15 \* 60/,
  );
  assert.match(publish, /channelVideo\.bucket === "booster"/);
  assert.match(publish, /String\(candidate\.video\?\.bucket \|\| "booster"\)/);
  assert.match(publish, /loadFirstAvailableTikTokVideo\(\[/);
  assert.match(publish, /probeTikTokRangeSource\(\{ source \}\)/);
  assert.match(publish, /tiktokDirectPostVideoFileUpload\(\{/);
  assert.match(publish, /rangeSource:\s*tiktokVideoSource!/);
  assert.match(publish, /onCheckpoint:\s*persistTikTokUploadCheckpoint/);
  assert.match(publish, /buildTiktokMediaProxyUrl\(/);
});

test("aucun nouveau binaire navigateur n'est envoyé à une route étape 7", () => {
  const policy = read("lib/mediaPipelineUnifiedConsumptionPolicy.ts");
  const resolver = read("lib/mediaWorkspaceConsumption.ts");
  assert.doesNotMatch(policy, /FormData|arrayBuffer|base64/);
  assert.doesNotMatch(resolver, /request\.formData|request\.arrayBuffer/);
  assert.match(resolver, /supabaseAdmin\.storage/);
});
