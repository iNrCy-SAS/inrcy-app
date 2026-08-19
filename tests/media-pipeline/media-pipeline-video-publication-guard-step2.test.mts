import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canPublishVideoSourceDirectly } from "../../lib/mediaVideoSourceCompatibility.ts";
import {
  getVideoPublicationPolicy,
  validateVideoPublicationForChannel,
} from "../../lib/videoPublicationPolicy.ts";
import {
  INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "../../lib/mediaRules.ts";

const ROOT = process.cwd();

async function readSource(relativePath: string) {
  return await readFile(path.resolve(ROOT, relativePath), "utf8");
}

test("une source MP4 passe exactement à 75 Mo et échoue un octet au-dessus", () => {
  assert.equal(
    canPublishVideoSourceDirectly({
      name: "video-75-mo.mp4",
      mimeType: "video/mp4",
      sizeBytes: 75_000_000,
      maxBytes: INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
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
      name: "video-trop-lourde.mp4",
      mimeType: "video/mp4",
      sizeBytes: 75_000_001,
      maxBytes: INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      hasAudio: true,
      containerFormats: ["mov", "mp4"],
      pixelFormat: "yuv420p",
    }),
    false,
  );
  assert.equal(
    canPublishVideoSourceDirectly({
      name: "taille-inconnue.mp4",
      mimeType: "video/mp4",
      maxBytes: INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      hasAudio: true,
      containerFormats: ["mov", "mp4"],
      pixelFormat: "yuv420p",
    }),
    false,
  );
});

test("les limites vidéo sont contrôlées canal par canal", () => {
  assert.equal(getVideoPublicationPolicy("tiktok").maxBytes, 75_000_000);
  assert.equal(getVideoPublicationPolicy("tiktok").maxDurationSeconds, 10 * 60);
  assert.equal(getVideoPublicationPolicy("linkedin").maxDurationSeconds, 30 * 60);
  assert.equal(getVideoPublicationPolicy("instagram").maxDurationSeconds, 15 * 60);
  assert.equal(getVideoPublicationPolicy("pinterest").maxDurationSeconds, 15 * 60);

  assert.equal(
    validateVideoPublicationForChannel({
      channel: "tiktok",
      name: "video.mp4",
      type: "video/mp4",
      storagePath: "videos/video.mp4",
      sizeBytes: 70_000_000,
      durationSeconds: 600,
    }).ok,
    true,
  );
  assert.equal(
    validateVideoPublicationForChannel({
      channel: "tiktok",
      name: "video.mp4",
      type: "video/mp4",
      storagePath: "videos/video.mp4",
      sizeBytes: 70_000_000,
      durationSeconds: 717,
    }).ok,
    false,
  );
  assert.equal(
    validateVideoPublicationForChannel({
      channel: "pinterest",
      name: "video.mp4",
      type: "video/mp4",
      storagePath: "videos/video.mp4",
      sizeBytes: 70_000_000,
      durationSeconds: 901,
    }).ok,
    false,
  );
  assert.equal(
    validateVideoPublicationForChannel({
      channel: "linkedin",
      name: "video.mp4",
      type: "video/mp4",
      storagePath: "videos/video.mp4",
      sizeBytes: 70_000_000,
    }).ok,
    false,
  );
});

test("les uploads partagent le plafond de 75 Mo sans compression automatique", async () => {
  const rules = await readSource("lib/mediaRules.ts");
  const intent = await readSource("app/api/media-pipeline/upload-intent/route.ts");
  const event = await readSource("app/api/media-pipeline/upload-event/route.ts");
  const workspace = await readSource("lib/mediaWorkspaceConsumption.ts");
  const hook = await readSource(
    "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
  );

  assert.match(
    rules,
    /INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES\s*=\s*[\r\n\s]*INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/,
  );
  assert.match(
    rules,
    /INR_MEDIA_VIDEO_SOURCE_MAX_BYTES\s*=\s*75_000_000/,
  );
  assert.equal(INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES, 75_000_000);
  assert.doesNotMatch(rules, /INR_MEDIA_VIDEO_COMPRESSION_TRIGGER_BYTES/);
  assert.match(intent, /getUniversalMediaProductMaxBytes\(mediaType\)/);
  for (const source of [event, workspace]) {
    assert.match(source, /maxBytes:\s*INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES/);
  }
  assert.doesNotMatch(intent, /40\s*\*\s*1024\s*\*\s*1024|40894464/);
  assert.doesNotMatch(event, /40\s*\*\s*1024\s*\*\s*1024|40894464/);
  assert.doesNotMatch(hook, /background video prewarm skipped/);
  assert.match(hook, /buildBoosterSourceMediaMetadata/);
  assert.match(hook, /target:\s*"workspace_source"/);
  assert.match(hook, /runPreparationMission\("publication_preparation"\)/);
});

test("la finalisation serveur valide chaque canal et isole les adaptations", async () => {
  const modal = await readSource(
    "app/dashboard/booster/publier/PublishModal.tsx",
  );
  const controller = await readSource(
    "app/dashboard/booster/publier/usePublishVideoController.ts",
  );
  const prewarm = await readSource(
    "app/api/media-pipeline/workspace/prewarm/route.ts",
  );
  const publish = await readSource("app/api/booster/publish-now/route.ts");
  const policy = await readSource("lib/videoPublicationPolicy.ts");
  const variants = await readSource("lib/boosterVideoVariantServer.ts");

  assert.match(modal, /async function ensureCutoverVideoVariantsReady/);
  assert.match(modal, /i18nT\("publication_checking_media"\)/);
  assert.match(modal, /setPublishProgressLabel\(i18nT\("progress_media_preparation"\)\)/);
  assert.doesNotMatch(modal, /Compression des médias/);
  assert.match(controller, /validateVideoPublicationForChannel/);
  assert.match(prewarm, /invalidSignatures/);
  assert.match(prewarm, /invalidChannels/);
  assert.match(prewarm, /validateVideoPublicationForChannel/);
  assert.match(publish, /preflightFailuresByChannel/);
  assert.match(publish, /setPreflightFailure/);
  assert.match(publish, /buildBoosterPublicationDispatchPlan/);
  assert.match(publish, /validateVideoPublicationForChannel/);
  assert.match(policy, /maxDurationSeconds:\s*null/);
  assert.match(
    policy,
    /PINTEREST_VIDEO_MAX_DURATION_SECONDS\s*=\s*15\s*\*\s*60/,
  );
  assert.match(
    policy,
    /maxDurationSeconds:\s*PINTEREST_VIDEO_MAX_DURATION_SECONDS/,
  );
  assert.match(
    variants,
    /fallbackToOriginalAllowed\s*=\s*[\s\S]{0,220}publicationProfile\s*===\s*"light_background"[\s\S]{0,120}format\s*===\s*"original"/,
  );
});

test("Pinterest ne conserve plus l'ancien plafond interne de 40 Mo", async () => {
  const pinterest = await readSource("lib/pinterestPublish.ts");
  assert.match(pinterest, /getVideoPublicationPolicy\("pinterest"\)/);
  assert.doesNotMatch(pinterest, /40\s*\*\s*1024\s*\*\s*1024/);
  assert.doesNotMatch(pinterest, /40 Mo/);
});
