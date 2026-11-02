import { readVideoNormalizationWorkerSource } from "./video-worker-sources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  canPublishVideoSourceDirectly,
  getDirectVideoCompatibility,
  normalizeVideoFrameRate,
} from "../../lib/mediaVideoSourceCompatibility.ts";
import { validateVideoPublicationForChannel } from "../../lib/videoPublicationPolicy.ts";
import { parseFfmpegVideoStreamMetadata } from "../../lib/mediaVideoProbeMetadata.ts";
import { sanitizeClientMediaMetadata } from "../../lib/mediaClientMetadata.ts";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS,
} from "../../lib/mediaRules.ts";

const MB = 1024 * 1024;
const ROOT = process.cwd();

const PROVEN_MP4 = {
  sizeBytes: 24 * MB,
  maxBytes: 75_000_000,
  videoCodec: "h264",
  audioCodec: "aac",
  frameRate: 29.97,
  hasAudio: true,
  containerFormats: ["mov", "mp4", "m4a", "3gp", "3g2", "mj2"],
  pixelFormat: "yuv420p",
  requireCodecProof: true,
} as const;

test("le transport garde tous les formats universels autorisÃ©s", () => {
  const imageExtensions = new Set<string>(INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS);
  const videoExtensions = new Set<string>(INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS);
  for (const extension of ["jpg", "png", "webp", "gif", "avif", "heic", "tiff", "bmp"]) {
    assert.ok(imageExtensions.has(extension));
  }
  for (const extension of ["mp4", "m4v", "mov"]) {
    assert.ok(videoExtensions.has(extension));
  }
  for (const extension of ["webm", "mkv", "avi"]) {
    assert.equal(videoExtensions.has(extension), false);
  }
});

test("WebM et MKV ne peuvent pas être publiés directement", () => {
  for (const source of [
    { name: "navigateur.webm", mimeType: "video/webm" },
    { name: "studio.mkv", mimeType: "video/x-matroska" },
  ]) {
    assert.deepEqual(getDirectVideoCompatibility({ ...source, ...PROVEN_MP4 }), {
      compatible: false,
      action: "adaptation_required",
      reason: "container_incompatible",
    });
  }
});

test("un MP4, M4V ou MOV H.264/AAC prouvé conserve exactement l'original", () => {
  assert.deepEqual(
    getDirectVideoCompatibility({
      name: "original.mp4",
      mimeType: "video/mp4",
      ...PROVEN_MP4,
    }),
    { compatible: true, action: "original", reason: "compatible" },
  );
  assert.equal(
    canPublishVideoSourceDirectly({
      name: "original-sans-audio.m4v",
      mimeType: "video/x-m4v",
      ...PROVEN_MP4,
      audioCodec: "none",
      hasAudio: false,
      frameRate: "30000/1001",
    }),
    true,
  );
  assert.equal(
    canPublishVideoSourceDirectly({
      name: "iphone.mov",
      mimeType: "video/quicktime",
      ...PROVEN_MP4,
    }),
    true,
  );
  assert.equal(normalizeVideoFrameRate("30000/1001"), 29.97);
});

test("un faux MP4 ou un pixel format incompatible demande une adaptation", () => {
  assert.deepEqual(
    getDirectVideoCompatibility({
      name: "matroska-renomme.mp4",
      mimeType: "video/mp4",
      ...PROVEN_MP4,
      containerFormats: ["matroska", "webm"],
    }),
    {
      compatible: false,
      action: "adaptation_required",
      reason: "container_proof_incompatible",
    },
  );
  assert.deepEqual(
    getDirectVideoCompatibility({
      name: "couleur-incompatible.mp4",
      mimeType: "video/mp4",
      ...PROVEN_MP4,
      pixelFormat: "yuv444p",
    }),
    {
      compatible: false,
      action: "adaptation_required",
      reason: "pixel_format_incompatible",
    },
  );
});

test("le probe FFmpeg extrait codec, dimensions et FPS effectif", () => {
  const parsed = parseFfmpegVideoStreamMetadata(
    "Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080, 29.97 fps, 29.97 tbr, 30k tbn",
  );
  assert.deepEqual(parsed, {
    width: 1920,
    height: 1080,
    codec: "h264",
    pixelFormat: "yuv420p",
    frameRate: 29.97,
  });
});

test("codec, audio ou FPS incompatible demande une adaptation sans bloquer le lot", () => {
  assert.deepEqual(
    getDirectVideoCompatibility({
      name: "mp4-ne-suffit-pas.mp4",
      mimeType: "video/mp4",
      sizeBytes: 10 * MB,
      maxBytes: 75_000_000,
    }),
    {
      compatible: false,
      action: "adaptation_required",
      reason: "container_proof_unknown",
    },
  );

  const cases = [
    { videoCodec: "vp9", reason: "video_codec_incompatible" },
    { videoCodec: "unknown", reason: "video_codec_unknown" },
    { audioCodec: "opus", reason: "audio_codec_incompatible" },
    { audioCodec: "unknown", reason: "audio_codec_unknown" },
    { frameRate: 120, reason: "frame_rate_incompatible" },
    { frameRate: null, reason: "frame_rate_unknown" },
  ] as const;

  for (const override of cases) {
    const decision = getDirectVideoCompatibility({
      name: "source.mp4",
      mimeType: "video/mp4",
      ...PROVEN_MP4,
      ...override,
    });
    assert.equal(decision.compatible, false);
    assert.equal(decision.action, "adaptation_required");
    assert.equal(decision.reason, override.reason);
  }
});

test("la preuve codec/FPS ne contourne jamais durÃ©e, poids ou rÃ©solution par canal", () => {
  const common = {
    name: "source.mp4",
    type: "video/mp4",
    storagePath: "source.mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    frameRate: 30,
    hasAudio: true,
    containerFormats: ["mov", "mp4"],
    pixelFormat: "yuv420p",
    requireCodecProof: true,
  } as const;

  const tooLong = validateVideoPublicationForChannel({
    ...common,
    channel: "tiktok",
    sizeBytes: 20 * MB,
    durationSeconds: 601,
  });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.reason, "video_duration_too_long");

  const tooHeavy = validateVideoPublicationForChannel({
    ...common,
    channel: "gmb",
    sizeBytes: 75_000_001,
    durationSeconds: 20,
    width: 1280,
    height: 720,
  });
  assert.equal(tooHeavy.ok, false);
  if (!tooHeavy.ok) assert.equal(tooHeavy.reason, "video_too_large");

  const tooSmall = validateVideoPublicationForChannel({
    ...common,
    channel: "gmb",
    sizeBytes: 20 * MB,
    durationSeconds: 20,
    width: 640,
    height: 360,
  });
  assert.equal(tooSmall.ok, false);
  if (!tooSmall.ok) assert.equal(tooSmall.reason, "video_resolution_too_small");
});

test("les ingress retirent toute preuve pipeline forgÃƒÂ©e image ou vidÃƒÂ©o", () => {
  const sanitized = sanitizeClientMediaMetadata({
    idea: "aperÃƒÂ§u autorisÃƒÂ©",
    source_metadata: {
      videoCodec: "h264",
      width: 1920,
      video_normalization: { source: { videoCodec: "h264" } },
      image_normalization: { source: { format: "jpeg" } },
    },
    video_normalization: {
      source: { videoCodec: "h264", containerFormats: ["mp4"] },
    },
    image_normalization: { source: { format: "jpeg", width: 1080 } },
    pipeline_mission: "publication_preparation",
    preparation_scope: "publication_preparation",
  });
  assert.equal(sanitized.idea, "aperÃƒÂ§u autorisÃƒÂ©");
  assert.deepEqual(sanitized.source_metadata, {
    videoCodec: "h264",
    width: 1920,
  });
  assert.equal("video_normalization" in sanitized, false);
  assert.equal("image_normalization" in sanitized, false);
  assert.equal("pipeline_mission" in sanitized, false);
  assert.equal("preparation_scope" in sanitized, false);
});

test("un workspace source-only inconnu se prÃ©chauffe puis s'auto-rÃ©pare durablement avant rÃ©solution", async () => {
  const [
    normalizer,
    worker,
    workspace,
    controller,
    publishRoute,
    uploadEvent,
    uploadIntent,
    workspaceApi,
    imagePreparation,
    durablePreparation,
    variantServer,
    videoTransformRoute,
    vercelConfig,
  ] = await Promise.all([
    readFile(path.join(ROOT, "lib/mediaVideoNormalizer.ts"), "utf8"),
    readVideoNormalizationWorkerSource(),
    readFile(path.join(ROOT, "lib/mediaWorkspaceConsumption.ts"), "utf8"),
    readFile(
      path.join(
        ROOT,
        "app/dashboard/booster/publier/usePublishVideoController.ts",
      ),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "app/api/booster/publish-now/route.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "app/api/media-pipeline/upload-event/route.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "app/api/media-pipeline/upload-intent/route.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "app/api/media-pipeline/workspace/route.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "lib/boosterImageServerPreparation.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "lib/mediaWorkspacePublicationPreparation.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "lib/boosterVideoVariantServer.ts"),
      "utf8",
    ),
    readFile(
      path.join(ROOT, "app/api/booster/video-transform/route.ts"),
      "utf8",
    ),
    readFile(path.join(ROOT, "vercel.json"), "utf8"),
  ]);

  assert.match(normalizer, /frameRate:\s*stream\.frameRate/);
  assert.match(normalizer, /source_frame_rate:\s*source\.frameRate/);
  assert.match(normalizer, /source_container_formats:\s*source\.containerFormats/);
  assert.match(normalizer, /libx264/);
  assert.match(normalizer, /output_container_format/);
  assert.match(worker, /source:\s*normalized\.source/);
  assert.match(worker, /width:\s*params\.normalized\.source\.orientedWidth/);
  assert.match(worker, /height:\s*params\.normalized\.source\.orientedHeight/);
  assert.match(
    worker,
    /duration_seconds:\s*params\.normalized\.source\.durationSeconds/,
  );
  assert.match(workspace, /requireCodecProof:\s*true/);
  assert.match(
    workspace,
    /const metadata = serverProbedVideoMetadataForMedia\(media\)/,
  );
  assert.match(
    workspace,
    /const normalization = asObject\(media\.mediaMetadata\.image_normalization\)/,
  );
  assert.match(controller, /requireCodecProof:\s*true/);
  assert.ok(
    (publishRoute.match(/requireCodecProof:\s*true/g) || []).length >= 2,
    "publish-now doit exiger la preuve sur les chemins source/original",
  );
  assert.match(
    publishRoute,
    /videoCodec:\s*trustedPublicationVideoMetadata\?\.videoCodec/,
  );
  assert.match(
    publishRoute,
    /hasTrustedPublicationVideoCompatibilityProof\s*&&\s*[\r\n\s]*canPublishVideoSourceDirectly/,
  );
  assert.match(
    uploadEvent,
    /mission:\s*sourceMetadataOnly[\s\S]{0,100}"publication_preparation"/,
  );
  assert.match(uploadEvent, /after\(async \(\) =>/);
  assert.match(uploadEvent, /processVideoNormalizationJobsForMedia\(/);
  assert.match(uploadEvent, /processImageNormalizationJobsForMedia\(/);
  assert.match(uploadEvent, /const directProof = probedSource/);
  assert.match(
    uploadEvent,
    /const persistedMetadata = current\.data\.media_metadata/,
  );
  assert.match(uploadEvent, /sanitizeClientMediaMetadata\(body\?\.metadata\)/);
  assert.match(uploadIntent, /sanitizeClientMediaMetadata\(body\.metadata\)/);
  assert.doesNotMatch(
    uploadIntent,
    /const metadata = cleanJsonObject\(body\.metadata\)/,
  );
  assert.match(workspaceApi, /width:\s*Number\(item\?\.width/);
  assert.match(workspaceApi, /height:\s*Number\(item\?\.height/);
  assert.match(
    workspaceApi,
    /durationSeconds:\s*Number\(item\?\.duration_seconds/,
  );
  assert.doesNotMatch(uploadEvent, /sharedCanonical|canonical_required/);
  assert.match(
    imagePreparation,
    /instagram:\s*new Set\(\["image\/jpeg"\]\)/,
  );
  assert.match(imagePreparation, /canSendOriginalImageToChannel\(/);
  assert.match(imagePreparation, /renderTechnicalImageCompatibility\(/);

  const durablePreparationIndex = publishRoute.indexOf(
    "prepareWorkspaceMediaForPublication({",
  );
  const workspaceResolutionIndex = publishRoute.indexOf(
    "resolveWorkspacePublicationConsumption({",
  );
  assert.ok(durablePreparationIndex >= 0);
  assert.ok(workspaceResolutionIndex > durablePreparationIndex);
  assert.match(
    durablePreparation,
    /const normalization = asRecord\(media\.mediaMetadata\.video_normalization\)/,
  );
  assert.match(durablePreparation, /probePotentialDirectVideo\(/);
  assert.ok(
    durablePreparation.indexOf("probePotentialDirectVideo({") <
      durablePreparation.indexOf("enqueueVideoNormalization({"),
  );
  assert.match(
    durablePreparation,
    /mission:\s*"publication_preparation"/,
  );
  assert.match(
    variantServer,
    /params\.trustedSourceCompatibilityProof === true/,
  );
  assert.doesNotMatch(
    videoTransformRoute,
    /trustedSourceCompatibilityProof:\s*true/,
  );
  assert.match(
    vercelConfig,
    /app\/api\/media-pipeline\/upload-event\/route\.ts/,
  );
});
