import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("la migration étape 6 est additive, idempotente et réservée au worker", () => {
  const sql = read(
    "ops/sql/2026-07-29_media_pipeline_step6_video_normalization.sql",
  );
  assert.match(sql, /^begin;/m);
  assert.match(sql, /create or replace function public\.inrcy_enqueue_video_normalization/);
  assert.match(sql, /create or replace function public\.inrcy_claim_video_normalization_jobs/);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /limit greatest\(1, least\(coalesce\(p_limit, 1\), 1\)\)/);
  assert.match(
    sql,
    /v_job_status in \('queued', 'processing', 'retry_wait'\)[\s\S]*then attempt_count/,
  );
  assert.doesNotMatch(
    sql,
    /attempt_count = case when v_job_status = 'processing' then attempt_count else 0 end/,
  );
  assert.match(sql, /grant execute on function[\s\S]+to service_role/i);
  assert.match(sql, /where bucket\.id = 'inrcy-pro-media'/);
  assert.match(sql, /'audio\/mpeg' = any\(bucket\.allowed_mime_types\)/);
  assert.match(sql, /when bucket\.allowed_mime_types is null then null/);
  assert.doesNotMatch(sql, /\bdrop\s+(table|column)\b|\btruncate\b/i);
});

test("le normaliseur extrait seulement les artefacts utiles depuis l'original", () => {
  const source = read("lib/mediaVideoNormalizer.ts");
  assert.match(source, /ffmpeg-static/);
  assert.match(source, /"libx264"/);
  assert.match(source, /"\+faststart"/);
  assert.match(source, /force_original_aspect_ratio=decrease/);
  assert.match(source, /force_divisible_by=2/);
  assert.match(source, /key:\s*"canonical"/);
  assert.doesNotMatch(source, /key:\s*"ai_preview"/);
  assert.match(source, /key:\s*"thumbnail"/);
  assert.match(source, /requestedFrameIndexes/);
  assert.match(source, /`frame_0\$\{index \+ 1\}`/);
  assert.match(source, /key:\s*"audio_track"/);
  assert.match(source, /FFMPEG_DERIVATIVE_TIMEOUT_MS = 75_000/);
  assert.match(source, /"-nostdin"/);
  assert.match(
    source,
    /thumbnailSize = await extractFrame\(\{[\s\S]*inputPath:\s*params\.inputPath[\s\S]*timestampSeconds:\s*captureTimes\[0\]/,
  );
});

test("la piste audio est facultative et ne bloque pas une vidéo silencieuse", () => {
  const source = read("lib/mediaVideoNormalizer.ts");
  assert.match(source, /source\.hasAudio\s*\?/);
  assert.match(source, /audioAvailable = false/);
  assert.match(source, /source_without_audio/);
  assert.match(source, /available:\s*audioAvailable/);
});

test("l'upload conserve l'original et lance seulement captures, audio ou miniature", () => {
  const event = read("app/api/media-pipeline/upload-event/route.ts");
  const intent = read("app/api/media-pipeline/upload-intent/route.ts");
  const prepare = read("app/api/media-pipeline/workspace/prepare/route.ts");
  assert.match(event, /sourceMetadataOnly/);
  assert.match(event, /reason:\s*"source_direct_ready"/);
  assert.match(event, /processVideoNormalizationAfterUpload\(\{/);
  assert.match(
    event,
    /mission:\s*"ai_preparation"[\s\S]*mission:\s*"publication_preparation"/,
  );
  assert.doesNotMatch(event, /workspaceAiNeedsSharedCanonical|sharedCanonical/);
  assert.match(intent, /pipeline_mission:\s*"source_metadata"/);
  assert.match(intent, /preparation_scope:\s*"source_only"/);
  assert.doesNotMatch(intent, /enqueueVideoNormalization\(/);
  assert.match(prepare, /enqueueVideoNormalization\(\{/);
  assert.match(prepare, /mission,/);
});


test("les captures locales commencent pour toute vidéo acceptée sans bloquer l'insertion", () => {
  const publishModal = read(
    "app/dashboard/booster/publier/PublishModal.tsx",
  );
  const addVideoBlock = publishModal.slice(
    publishModal.indexOf("const addVideoFile"),
    publishModal.indexOf("const onVideoChange"),
  );
  assert.doesNotMatch(addVideoBlock, /getOrPrepareVideoFramesForAI/);
  assert.doesNotMatch(addVideoBlock, /getOrPrepareVideoAudioFileForAI/);
  assert.match(publishModal, /void getOrPrepareVideoFramesForAI\(videoFile\)/);
  assert.doesNotMatch(publishModal, /BOOSTER_LOCAL_VIDEO_FRAME_PREWARM_MIN_BYTES/);
  assert.match(
    publishModal,
    /const framesResult = await settleOptionalMediaEnrichment\([\s\S]*getOrPrepareVideoFramesForAI\(videoFile\)/,
  );
  assert.doesNotMatch(publishModal, /transcribeVideoAudioForAI\(/);
});

test("le worker télécharge la source privée et conserve l'original", () => {
  const worker = read("lib/mediaVideoNormalizationWorker.ts");
  const cron = read("app/api/cron/media-video-normalization/route.ts");
  assert.match(
    worker,
    /createSafeStorageSignedUrl\(\s*media\.bucket_name,\s*media\.storage_path,\s*600/,
  );
  assert.match(worker, /Readable\.fromWeb/);
  assert.match(worker, /createReadStream\(params\.normalized\.filePath\)/);
  assert.doesNotMatch(worker, /readFile\(params\.normalized\.filePath\)/);
  assert.match(worker, /VIDEO_NORMALIZATION_MAX_SOURCE_MB_LABEL/);
  assert.match(worker, /content_hash_sha256/);
  assert.match(worker, /outputs\.canonical/);
  assert.match(worker, /const originalPublicationReady = canPublishOriginalVideo/);
  assert.match(worker, /keys:\s*pendingVariants\.map/);
  assert.match(worker, /failed_retryable/);
  assert.match(worker, /retry_wait/);
  assert.match(
    worker,
    /`users\/\$\{media\.user_id\}\/ai-generated\/video\/`/,
  );
  assert.match(worker, /media\.bucket_name === "inrcy-pro-media"/);
  assert.match(worker, /\.eq\("user_id", job\.account_id\)/);
  assert.doesNotMatch(worker, /\.remove\(\[media\.storage_path\]\)/);
  assert.doesNotMatch(cron, /\.formData\s*\(/);
  assert.doesNotMatch(cron, /\.arrayBuffer\s*\(/);
});

test("le workspace attend aussi la normalisation vidéo quand son flag est actif", () => {
  const source = read("lib/mediaWorkspaceServer.ts");
  assert.match(source, /isImageNormalizationEnabled\(\)/);
  assert.match(source, /isVideoNormalizationEnabled\(\)/);
  assert.match(source, /status\.mediaType === "video" && videoNormalizationEnabled/);
  assert.match(
    source,
    /\["ready", "legacy_ready"\]\.includes\(status\.publicationStatus\)/,
  );
  assert.match(
    source,
    /!\["ready", "legacy_ready"\]\.includes\(status\.publicationStatus\)/,
  );
  assert.match(source, /failed_terminal/);
});

test("le cron vidéo est protégé, isolé et embarque FFmpeg", () => {
  const cron = read("app/api/cron/media-video-normalization/route.ts");
  const vercel = read("vercel.json");
  const oldTransform = read("app/api/booster/video-transform/route.ts");
  const inrSend = read("app/dashboard/mails/MailboxClient.tsx");
  assert.match(cron, /VERCEL_CRON_SECRET/);
  assert.match(cron, /repairPendingVideoNormalizationQueue/);
  assert.match(cron, /processVideoNormalizationJobs/);
  assert.match(cron, /maxDuration = 1800/);
  assert.match(vercel, /\/api\/cron\/media-video-normalization/);
  assert.match(vercel, /app\/api\/cron\/media-video-normalization\/route\.ts/);
  assert.match(vercel, /node_modules\/ffmpeg-static\/\*\*\/\*/);
  assert.match(oldTransform, /buildVideoTransformPlan/);
  assert.match(inrSend, /buildVideoTransformSignature/);
});

test("le test Booster obsolète vérifie maintenant la branche réelle", () => {
  const source = read(
    "tests/booster-image-decision/booster-image-pipeline-step3.test.mjs",
  );
  assert.match(source, /sourceFile:\\s\*file/);
  assert.match(source, /assert\.doesNotMatch\(originalBranch, \/renderChannelImage/);
  assert.doesNotMatch(source, /fileToImagePayload\\\(file/);
});
