import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

test("les limites et formats source correspondent au contrat produit", () => {
  const rules = read("lib/mediaRules.ts");
  assert.match(rules, /INR_MEDIA_IMAGE_MAX_BYTES\s*=\s*50\s*\*\s*1024\s*\*\s*1024/);
  assert.match(
    rules,
    /INR_MEDIA_PUBLICATION_IMAGES_TOTAL_MAX_BYTES\s*=\s*150\s*\*\s*1024\s*\*\s*1024/,
  );
  assert.match(
    rules,
    /INR_MEDIA_VIDEO_SOURCE_MAX_BYTES\s*=\s*75_000_000/,
  );
  assert.match(rules, /INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT\s*=\s*5/);
  for (const format of [
    "heic",
    "heif",
    "tiff",
    "bmp",
    "jfif",
  ]) {
    assert.match(rules.toLowerCase(), new RegExp(`"${format}"`));
  }
  assert.match(
    rules,
    /INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS\s*=\s*\[\s*"mp4",\s*"m4v",\s*"mov"/,
  );
  assert.match(rules, /INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES\s*=\s*[\r\n\s]*INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/);
});

test("HEIC et HEIF ne traversent plus une route de conversion Vercel", () => {
  const controller = read(
    "app/dashboard/booster/publier/usePublishImageController.ts",
  );
  const shared = read(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
  );
  assert.equal(
    existsSync(resolve(ROOT, "app/api/booster/convert-image/route.ts")),
    false,
  );
  assert.doesNotMatch(controller, /convertHeicOrHeifImageFile/);
  assert.doesNotMatch(shared, /\/api\/booster\/convert-image/);
  assert.match(controller, /buildLocalImagePresentation/);
  assert.match(controller, /i18nT\("image_preview_prepared_server"\)/);
});

test("les formats annoncés disposent d'un décodeur serveur", () => {
  const normalizer = read("lib/mediaImageNormalizer.ts");
  const policy = read("lib/mediaImageNormalizationPolicy.ts");
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies["bmp-js"], "^0.1.0");
  assert.match(normalizer, /import bmp from "bmp-js"/);
  assert.match(normalizer, /convertBmpSource/);
  assert.match(
    normalizer,
    /normalizeWithSharp\(converted,\s*"bmp-js",\s*params\.purposes\)/,
  );
  assert.match(policy, /IMAGE_NORMALIZATION_BMP_MAX_INPUT_PIXELS\s*=\s*25_000_000/);
});

test("les dépendances de production médias sont corrigées et verrouillées", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies.next, "^16.2.11");
  assert.equal(pkg.dependencies.sharp, "0.35.3");
  assert.equal(pkg.overrides.sharp, "0.35.3");
  assert.equal(pkg.overrides["brace-expansion@5.0.7"], "5.0.9");
  assert.equal(pkg.overrides["fast-uri"], "3.1.4");
});

test("les sources partent en parallèle sans préparation lourde et les MP4 directs évitent FFmpeg", () => {
  const hook = read(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const prepare = read(
    "app/api/media-pipeline/workspace/prepare/route.ts",
  );
  const imageWorker = read("lib/mediaImageNormalizationWorker.ts");
  assert.match(hook, /mediaType\s*===\s*"video"\s*\?\s*1\s*:\s*3/);
  assert.match(hook, /Promise\.all\(/);
  assert.doesNotMatch(hook, /queueBackgroundPreparation/);
  assert.match(hook, /target:\s*"workspace_source"/);
  assert.match(hook, /prepareAiMedia/);
  assert.match(hook, /preparePublicationMedia/);
  assert.doesNotMatch(modal, /directOriginalAvailable/);
  assert.match(
    modal,
    /mediaPipelineCutoverV1:\s*true,[\s\S]{0,100}allowOriginalVideoFallback:\s*false/,
  );
  assert.match(hook, /loadMediaPublicationWorkspace\(/);
  assert.match(prepare, /processImageNormalizationJobsForMedia/);
  assert.match(prepare, /limit:\s*120/);
  assert.match(prepare, /window:\s*"10 m"/);
  assert.match(imageWorker, /\.slice\(0,\s*5\)/);
  assert.match(
    imageWorker,
    /claimedJobs\.slice\(index,\s*index\s*\+\s*2\)\.map\(processClaimedImageJob\)/,
  );
});

test("l'original reste publiable et les incidents d'extraction sont rejoués", () => {
  const missions = read("lib/boosterMediaPipelineMissions.ts");
  const worker = read("lib/mediaVideoNormalizationWorker.ts");
  const failurePlan = read("lib/mediaVideoNormalizationFailurePlan.ts");
  const videoMissions = missions.slice(
    missions.indexOf("BOOSTER_VIDEO_PREPARATION_KEYS"),
  );
  assert.match(videoMissions, /publication_preparation:\s*\["canonical", "thumbnail"\]/);
  assert.doesNotMatch(videoMissions, /"ai_preview"/);
  const terminalBlock =
    worker.match(/const terminal\s*=([\s\S]*?);\s*[\r\n]+\s*return new VideoNormalizationError/)?.[1] ||
    "";
  assert.ok(terminalBlock, "classification terminale introuvable");
  for (const retryable of [
    "video_frames_unavailable",
  ]) {
    assert.doesNotMatch(terminalBlock, new RegExp(retryable));
  }
  assert.match(worker, /planVideoNormalizationFailure/);
  assert.match(worker, /const status = failurePlan\.status/);
  assert.match(
    failurePlan,
    /retryableError && !exhausted[\s\S]*?\? "retry_wait"[\s\S]*?: "failed"/,
  );
  assert.match(worker, /const originalPublicationReady = canPublishOriginalVideo/);
});

test("les variantes par canal sont persistantes et la publication reste légère", () => {
  const images = read("lib/boosterImageServerPreparation.ts");
  const consumption = read("lib/mediaWorkspaceConsumption.ts");
  const videos = read("lib/boosterVideoVariantServer.ts");
  const prewarm = read(
    "app/api/media-pipeline/workspace/prewarm/route.ts",
  );
  const publish =
    read("app/api/booster/publish-now/route.ts") +
    read("app/api/booster/publish-now/publishNow.server-preparation.ts");
  assert.match(images, /purpose:\s*"channel_publish"/);
  assert.match(images, /workspace-channel-images/);
  assert.match(images, /publicationReady:\s*true/);
  assert.match(images, /readKnownImageMeta\(image\.imageMeta\)/);
  assert.match(images, /const resolveInput = async/);
  assert.match(
    images,
    /displayPlan\.decision\.mode === "original"[\s\S]*no Storage[\s\S]*download, Sharp render, channel upload or media_variants write/,
  );
  assert.match(consumption, /ratio:\s*canonical\.width\s*\/\s*canonical\.height/);
  assert.match(videos, /purpose:\s*"channel_publish"/);
  assert.match(videos, /workspace-channel-videos/);
  assert.match(videos, /generateMissing\s*===\s*false/);
  assert.match(
    prewarm,
    /generateMissing:\s*generateMissingVideoVariants/,
  );
  assert.match(
    prewarm,
    /body\?\.generateMissingVideoVariants\s*!==\s*false/,
  );
  assert.match(
    publish,
    /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/,
  );
  assert.doesNotMatch(publish, /preparePublicationVariants\(true\)/);
  assert.doesNotMatch(publish, /requiresPreparedNetworkVideoVariant/);
  assert.match(
    publish,
    /usesOriginalSource && sourceDirectlyPublishable[\s\S]*return \[\]/,
  );
  assert.match(publish, /invalidVideoChannels\.forEach/);
  assert.match(publish, /preflightFailuresByChannel/);
  assert.match(publish, /img\.publicationReady\s*===\s*true/);
  assert.match(publish, /strictMediaCutover\s*\?\s*\[\]\s*:\s*images/);
});

test("l'upload n'est confirmé qu'après vérification de l'objet stocké", () => {
  const uploadEvent = read("app/api/media-pipeline/upload-event/route.ts");
  assert.match(uploadEvent, /async function verifyStoredUpload/);
  assert.match(uploadEvent, /\.storage\.from\(params\.bucket\)\.list\(folder/);
  assert.match(uploadEvent, /storedSize\s*===\s*params\.expectedSize/);
  assert.match(uploadEvent, /if\s*\(!verified\)/);
});

test("les médias détachés restent récupérables 24 h puis sont purgés", () => {
  const workspace = read("app/api/media-pipeline/workspace/route.ts");
  const cleanup = read("app/api/cron/media-orphan-cleanup/route.ts");
  const vercel = JSON.parse(read("vercel.json"));
  assert.match(workspace, /Date\.now\(\)\s*\+\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1_000/);
  assert.match(workspace, /original_retention_until:\s*retentionUntil/);
  assert.match(cleanup, /publication_workspace_media/);
  assert.match(cleanup, /\.remove\(Array\.from\(paths\)\)/);
  assert.match(cleanup, /original_deleted_at:\s*now/);
  assert.ok(
    vercel.crons.some(
      (item) =>
        item.path === "/api/cron/media-orphan-cleanup" &&
        item.schedule === "17 * * * *",
    ),
  );
});

test("le durcissement SQL aligne Storage et ferme les écritures directes", () => {
  const sql = read(
    "ops/sql/2026-07-30_media_pipeline_step10_performance_hardening.sql",
  );
  assert.match(sql, /file_size_limit\s*=\s*314572800/);
  assert.match(
    sql,
    /signature\s*=\s*'inrcy:video:canonical:v1'[\s\S]*coalesce\(size_bytes,\s*0\)\s*>\s*40894464/,
  );
  assert.match(sql, /processing_status\s*=\s*'not_requested'/);
  assert.match(sql, /job\.job_type\s*=\s*'video_normalize_v1'/);
  for (const mime of [
    "image/heic",
    "image/heif",
    "image/tiff",
    "image/bmp",
    "video/x-matroska",
    "video/3gpp",
    "audio/mpeg",
  ]) {
    assert.match(sql, new RegExp(`'${mime.replace("/", "\\/")}'`));
  }
  assert.match(sql, /drop policy if exists "inrcy_pro_media_insert_own"/);
  assert.match(
    sql,
    /revoke insert,\s*update,\s*delete on public\.pro_media_library from authenticated/,
  );
  assert.match(sql, /inrcy_validate_media_storage_scope/);
});
