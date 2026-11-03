import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canPublishVideoSourceDirectly } from "../../lib/mediaVideoSourceCompatibility.ts";
import {
  buildTikTokVideoUploadPlan,
  TIKTOK_DEFAULT_CHUNK_BYTES,
  TIKTOK_VIDEO_UPLOAD_MAX_BYTES,
} from "../../lib/tiktokUploadPlan.ts";

const ROOT = process.cwd();
const MB = 1024 * 1024;

async function readSource(relativePath: string) {
  return await readFile(path.resolve(ROOT, relativePath), "utf8");
}

test("MP4, M4V et MOV H.264/AAC utilisent directement la source stockée", () => {
  assert.equal(
    canPublishVideoSourceDirectly({
      name: "publication.MP4",
      mimeType: "video/mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      hasAudio: true,
      containerFormats: ["mov", "mp4"],
      pixelFormat: "yuv420p",
    }),
    true,
  );
  assert.equal(
    canPublishVideoSourceDirectly({
      storagePath: "users/u/source/video.m4v",
      mimeType: "application/octet-stream",
      videoCodec: "h264",
      audioCodec: "none",
      frameRate: 25,
      hasAudio: false,
      containerFormats: ["mov", "mp4"],
      pixelFormat: "yuv420p",
    }),
    true,
  );
  assert.equal(
    canPublishVideoSourceDirectly({
      name: "camera.mov",
      mimeType: "video/quicktime",
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      hasAudio: true,
      containerFormats: ["mov"],
      pixelFormat: "yuv420p",
    }),
    true,
  );
});

test("TikTok reçoit une vidéo de 30 Mo en un morceau", () => {
  assert.deepEqual(buildTikTokVideoUploadPlan(30 * MB), {
    chunkSize: 30 * MB,
    totalChunkCount: 1,
  });
});

test("TikTok découpe la limite exacte de 75 Mo sans modifier la vidéo", () => {
  assert.deepEqual(buildTikTokVideoUploadPlan(75_000_000), {
    chunkSize: TIKTOK_DEFAULT_CHUNK_BYTES,
    totalChunkCount: 2,
  });
});

test("TikTok refuse une vidéo au-dessus du plafond de transport du fournisseur", () => {
  assert.throws(
    () => buildTikTokVideoUploadPlan(TIKTOK_VIDEO_UPLOAD_MAX_BYTES + 1),
    /tiktok_video_source_too_large/,
  );
});

test("publier et programmer sécurisent les sources tandis que le worker prépare les adaptations", async () => {
  const modal = await readSource(
    "app/dashboard/booster/publier/PublishModal.tsx",
  );
  const uploadEvent = await readSource(
    "app/api/media-pipeline/upload-event/route.ts",
  );
  const prepareRoute = await readSource(
    "app/api/media-pipeline/workspace/prepare/route.ts",
  );
  const publishRoute = await readSource(
    "app/api/booster/publish-now/route.ts",
  );

  assert.match(
    submission,
    /waitForPersistentWorkspaceReadiness\(\s*"publish"/,
  );
  assert.match(
    submission,
    /waitForPersistentWorkspaceReadiness\(\s*"schedule"/,
  );
  assert.match(modal, /await verifyPersistentWorkspaceSources\(sourceExpectations/);
  assert.doesNotMatch([modal, submission].join("\n"), /startBackgroundVideoPrewarm/);
  assert.doesNotMatch([modal, submission].join("\n"), /prepareCutoverVideoVariants/);
  const immediatePublish = submission.slice(
    submission.indexOf("const runPublish = async"),
    submission.indexOf("const performSchedulePublication = async"),
  );
  assert.doesNotMatch(
    immediatePublish,
    /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/,
  );
  assert.match(
    immediatePublish,
    /if \(shouldBuildVideoFallbackPayload\)[\s\S]*preparePublicationVideoVariants\(/,
  );
  const scheduledPublish = submission.slice(submission.indexOf("const performSchedulePublication = async"));
  assert.doesNotMatch(scheduledPublish, /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/);
  assert.match(scheduledPublish, /if \(shouldBuildScheduleVideoFallback\)[\s\S]*preparePublicationVideoVariants\(/);
  assert.match(scheduledPublish, /videoSettingsByChannel: buildChannelUnknownRecord\(\s*scheduleVideoSettingsByChannel/);
  assert.match(publishRoute, /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/);
  assert.match(publishRoute, /candidate\.signature === signature/);
  assert.match(publishRoute, /reason: "video_variant_required"/);
  assert.match(uploadEvent, /!directVideoSource/);
  assert.match(uploadEvent, /reason:\s*"source_direct_ready"/);
  assert.match(prepareRoute, /function canUseOriginalVideo/);
  assert.match(
    prepareRoute,
    /canUseOriginalVideo\(params\.media\)[\s\S]*hasVariant\(params\.variants, params\.media\.mediaId, "canonical"\)/,
  );
  assert.match(prepareRoute, /INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES/);
  assert.doesNotMatch(publishRoute, /oversizedPublicationVideo/);
});
