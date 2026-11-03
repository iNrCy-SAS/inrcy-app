import { readVideoNormalizationWorkerSource } from "../media-pipeline/video-worker-sources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyServerVideoFallbackAttestation } from "../../lib/boosterVideoFallbackAttestation.ts";
import {
  BOOSTER_REMOTE_VIDEO_PROBE_TIMEOUT_MS,
  validateBoosterRemoteVideoProbeTransport,
} from "../../lib/boosterVideoRemoteProbePolicy.ts";
import { validateVideoDurationForChannel } from "../../lib/videoPublicationPolicy.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("un workspace mixte résout les images et la vidéo sans dépendre de leur position", () => {
  const consumption = read("lib/mediaWorkspaceConsumption.ts");
  const start = consumption.indexOf(
    "export async function resolveWorkspacePublicationConsumption",
  );
  const end = consumption.indexOf(
    "export async function resolveWorkspaceAiConsumption",
    start,
  );
  const publicationResolver = consumption.slice(start, end);

  assert.match(
    publicationResolver,
    /media[\s\S]{0,30}\.filter\(\(item\) => item\.mediaType === "image"\)/,
  );
  assert.match(
    publicationResolver,
    /media\.find\(\(item\) => item\.mediaType === "video"\)/,
  );
  assert.match(publicationResolver, /images\.length && video[\s\S]{0,20}\? "mixed"/);
  assert.doesNotMatch(
    publicationResolver,
    /media\[0\]\?\.mediaType === "video"/,
  );
  assert.match(
    publicationResolver,
    /positiveMetadataNumber\(publicationVariant\?\.durationSeconds\)[\s\S]*sourceDuration/,
  );
  assert.doesNotMatch(
    publicationResolver,
    /videoDuration\s*=[\s\S]{0,180}item\.durationSeconds/,
  );
  assert.match(
    consumption,
    /Number\(row\.duration_seconds\) > 0[\s\S]*\? Number\(row\.duration_seconds\)[\s\S]*: null/,
  );
});

test("publish-now utilise les deux familles du workspace et transmet la preuve serveur au worker YouTube", () => {
  const route = read("app/api/booster/publish-now/route.ts");

  assert.match(route, /const workspaceHasImages = Boolean\(workspaceConsumption\?\.images\.length\)/);
  assert.match(route, /const workspaceHasVideo = Boolean\(workspaceConsumption\?\.video\)/);
  assert.match(route, /expectedMode === "images" && workspaceHasImages/);
  assert.match(route, /expectedMode === "video" && workspaceHasVideo/);
  assert.match(
    route,
    /internalAsyncDispatch &&[\s\S]{0,100}body\._asyncTrustedVideoCompatibilityProof === true/,
  );
  assert.match(
    route,
    /_asyncTrustedVideoCompatibilityProof:[\s\S]{0,100}channelMediaMode === "video"[\s\S]{0,100}hasTrustedPublicationVideoCompatibilityProof/,
  );
  assert.match(
    route,
    /const trustedPublicationVideoDuration =[\s\S]*publicationVideo\?\.duration \?\? null/,
  );
});

test("workspace images + fallback vidéo 3:38 obtient une attestation FFmpeg avant le préflight YouTube", () => {
  const clientFallback = {
    name: "video.mp4",
    type: "video/mp4",
    size: 20_000_000,
    duration: 217.792,
    bucket: "booster",
    storagePath: "account/booster-videos/video.mp4",
    publicUrl: "https://storage.example/video.mp4",
    sourceMetadata: {
      width: 1728,
      height: 1080,
      duration: 217.792,
    },
  };
  const attested = applyServerVideoFallbackAttestation(clientFallback, {
    bucket: "booster",
    storagePath: "account/booster-videos/video.mp4",
    publicUrl: "https://storage.example/video.mp4",
    duration: 217.792,
    width: 1728,
    height: 1080,
    videoCodec: "h264",
    audioCodec: "aac",
    frameRate: 30,
    hasAudio: true,
    containerFormats: ["mov", "mp4"],
    pixelFormat: "yuv420p",
    compatibilityProof: "server_ffmpeg",
  });

  assert.equal(attested.duration, 217.792);
  assert.equal(attested.sourceMetadata.compatibilityProof, "server_ffmpeg");
  assert.equal(
    validateVideoDurationForChannel({
      channel: "youtube_shorts",
      durationSeconds: attested.duration,
      youtubeLongUploadsStatus: "allowed",
      enforceAccountCapabilities: true,
    }).ok,
    true,
  );

  assert.throws(
    () =>
      applyServerVideoFallbackAttestation(clientFallback, {
        bucket: "booster",
        storagePath: "account/booster-videos/video.mp4",
        publicUrl: "https://storage.example/video.mp4",
        duration: null,
        width: 1728,
        height: 1080,
        videoCodec: "h264",
        audioCodec: "aac",
        frameRate: 30,
        hasAudio: true,
        containerFormats: ["mov", "mp4"],
        pixelFormat: "yuv420p",
        compatibilityProof: "server_ffmpeg",
      }),
    /video_fallback_probe_incomplete/,
    "la durée navigateur ne doit jamais secourir un probe serveur incomplet",
  );

  const route = read("app/api/booster/publish-now/route.ts");
  const probeIndex = route.indexOf(
    "await probeStoredBoosterVideoForPublication",
  );
  const preflightIndex = route.indexOf(
    "const videoVariantRequest = activePreparationSelected",
  );
  assert.ok(probeIndex >= 0 && preflightIndex > probeIndex);
  assert.match(
    route,
    /internalAsyncPreparationDispatch &&[\s\S]{0,120}publicationVideo &&[\s\S]{0,80}!workspaceHasVideo/,
  );
});

test("la correction ne relâche aucune vraie limite de durée YouTube", () => {
  assert.equal(
    validateVideoDurationForChannel({
      channel: "youtube_shorts",
      durationSeconds: 218,
      youtubeLongUploadsStatus: "allowed",
      enforceAccountCapabilities: true,
    }).ok,
    true,
  );

  const unknown = validateVideoDurationForChannel({
    channel: "youtube_shorts",
    durationSeconds: null,
    youtubeLongUploadsStatus: "allowed",
    enforceAccountCapabilities: true,
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reason, "video_duration_unknown");

  const tooLong = validateVideoDurationForChannel({
    channel: "youtube_shorts",
    durationSeconds: 43_201,
    youtubeLongUploadsStatus: "allowed",
    enforceAccountCapabilities: true,
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.reason, "video_duration_too_long");
});

test("un workspace mixte vérifie les deux familles avant programmation et conserve le préwarm serveur typé", () => {
  const client = read("lib/mediaWorkspaceClient.ts");
  const hook = read(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const submission = read("app/dashboard/booster/publier/publicationSubmission.ts");
  const prewarm = read("app/api/media-pipeline/workspace/prewarm/route.ts");

  assert.match(client, /requestedMediaType\?: "images" \| "video"/);
  assert.match(hook, /requestedMediaType:\s*settings\?\.requestedMediaType/);
  assert.match(
    submission,
    /const requiredScheduleMediaTypes = \[[\s\S]{0,90}hasAnyImagePublish[\s\S]{0,90}hasAnyVideoPublish/,
  );
  assert.match(submission, /await waitForPersistentWorkspaceReadiness\(\s*"schedule"[\s\S]{0,400}requiredScheduleMediaTypes/);
  assert.match(modal, /await verifyPersistentWorkspaceSources\(sourceExpectations,/);
  assert.doesNotMatch([modal, submission].join("\n"), /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/);
  assert.match(
    prewarm,
    /consumption\.video && requestedMediaType !== "images"/,
  );
});

test("une source de 75 Mo est probée par ranges bornés, jamais chargée en Buffer", () => {
  const max = 75_000_000;
  assert.deepEqual(
    validateBoosterRemoteVideoProbeTransport({
      expectedSizeBytes: max,
      headContentLength: max,
      rangeStatus: 206,
      rangeContentRange: `bytes ${max - 1}-${max - 1}/${max}`,
    }),
    {
      sizeBytes: max,
      requiresByteRanges: true,
      byteRangesConfirmed: true,
    },
  );
  assert.equal(BOOSTER_REMOTE_VIDEO_PROBE_TIMEOUT_MS, 20_000);
  assert.throws(
    () =>
      validateBoosterRemoteVideoProbeTransport({
        expectedSizeBytes: max + 1,
        rangeStatus: 206,
        rangeContentRange: `bytes ${max}-${max}/${max + 1}`,
      }),
    /video_fallback_source_too_large/,
  );
  assert.throws(
    () =>
      validateBoosterRemoteVideoProbeTransport({
        expectedSizeBytes: max,
        headAcceptRanges: "bytes",
        rangeStatus: 200,
      }),
    /video_fallback_byte_ranges_required/,
  );

  const server = read("lib/boosterVideoVariantServer.ts");
  assert.match(server, /downloadSourceVideoToFile/);
  assert.match(server, /Readable\.fromWeb\(response\.body/);
  assert.match(server, /createWriteStream\(inputPath/);
  assert.match(server, /\.upload\(storagePath, createReadStream\(outputPath\)/);
  assert.doesNotMatch(server, /downloaded\.buffer|data\.arrayBuffer\(\)/);
  assert.match(server, /probeTransport:\s*"storage_http_byte_ranges"/);
  assert.match(server, /attestationSource:\s*"registry"/);
});

test("l'attestation fallback démarre à l'upload et une publication mixte attend les médias avant dispatch", () => {
  const intent = read("app/api/media-pipeline/upload-intent/route.ts");
  const uploadEvent = read("app/api/media-pipeline/upload-event/route.ts");
  const publish = read("app/api/booster/publish-now/route.ts");
  const normalizationWorker = readVideoNormalizationWorkerSource();

  assert.match(
    intent,
    /booster_video_source:\s*\{[\s\S]{0,360}registerSource:\s*true/,
  );
  assert.match(uploadEvent, /reason:\s*"source_probe_queued"/);
  assert.doesNotMatch(uploadEvent, /boosterPublicationNeedsCanonical|VIDEO_SHARED_CANONICAL_PREFERRED_SOURCE_BYTES/);
  assert.match(uploadEvent, /mission:\s*"publication_preparation"/);
  assert.match(
    uploadEvent,
    /after\(async \(\) => \{[\s\S]{0,200}probeStoredBoosterVideoForPublication/,
  );
  assert.match(
    publish,
    /shouldPrepareMixedMediaBeforeDispatch\(\{[\s\S]{0,240}imageChannelCount:\s*requestedImageChannels\.length,[\s\S]{0,100}videoChannelCount:\s*requestedVideoChannels\.length/,
  );
  assert.match(
    publish,
    /mixedMediaStillPending[\s\S]{0,320}requestedMediaChannels\.forEach\(\(channel\) =>[\s\S]{0,160}deferredPreparationChannels\.add\(channel\)/,
  );
  assert.match(
    publish,
    /mediaModeByChannel\[channel\] === "video" &&[\s\S]{0,100}!deferredPreparationChannels\.has\(channel\)/,
  );
  assert.match(normalizationWorker, /ownedBoosterSource/);
  assert.match(
    normalizationWorker,
    /\["booster-videos", "booster-drafts", "booster-video-source"\]/,
  );
});
