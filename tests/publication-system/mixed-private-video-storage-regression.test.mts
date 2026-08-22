import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeAsyncPreparationAttempt,
  resolveChannelDispatchMediaType,
  shouldPrepareMixedMediaBeforeDispatch,
} from "../../lib/boosterMixedMediaPreparationPolicy.ts";
import { applyServerVideoFallbackAttestation } from "../../lib/boosterVideoFallbackAttestation.ts";
import { authorizeStoredVideoProbeSource } from "../../lib/boosterStoredVideoProbePolicy.ts";
import { validateVideoDurationForChannel } from "../../lib/videoPublicationPolicy.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const accountId = "8d7ac7ae-3a49-4660-8e44-79837cc563cc";
const privateBucket = "inrcy-pro-media";
const privatePath = `users/${accountId}/source/youtube.mp4`;

function ownedUploadedVideoRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: accountId,
    bucket_name: privateBucket,
    storage_path: privatePath,
    media_type: "video",
    upload_status: "uploaded",
    ...overrides,
  };
}

test("un média vidéo privé uploadé et possédé est autorisé par son identité Storage exacte", () => {
  assert.deepEqual(
    authorizeStoredVideoProbeSource({
      accountId,
      bucket: privateBucket,
      storagePath: privatePath,
      registryRow: ownedUploadedVideoRow(),
    }),
    {
      bucket: privateBucket,
      storagePath: privatePath,
      urlMode: "signed",
      registryAuthorized: true,
    },
  );
});

test("un bucket privé refuse le mauvais propriétaire, le mauvais type et un upload inachevé", () => {
  for (const registryRow of [
    ownedUploadedVideoRow({ user_id: "other-account" }),
    ownedUploadedVideoRow({ media_type: "image" }),
    ownedUploadedVideoRow({ upload_status: "pending" }),
    ownedUploadedVideoRow({ storage_path: `${privatePath}.other` }),
    null,
  ]) {
    assert.throws(
      () =>
        authorizeStoredVideoProbeSource({
          accountId,
          bucket: privateBucket,
          storagePath: privatePath,
          registryRow,
        }),
      /video_fallback_storage_reference_untrusted/,
    );
  }
});

test("le fallback Booster historique reste limité au préfixe du compte", () => {
  assert.deepEqual(
    authorizeStoredVideoProbeSource({
      accountId,
      bucket: "booster",
      storagePath: `${accountId}/booster-videos/legacy.mp4`,
      registryRow: null,
    }),
    {
      bucket: "booster",
      storagePath: `${accountId}/booster-videos/legacy.mp4`,
      urlMode: "public",
      registryAuthorized: false,
    },
  );
  assert.throws(
    () =>
      authorizeStoredVideoProbeSource({
        accountId,
        bucket: "booster",
        storagePath: "other-account/booster-videos/legacy.mp4",
        registryRow: null,
      }),
    /video_fallback_storage_reference_untrusted/,
  );
});

test("chaque worker canal reçoit un type média strictement isolé", () => {
  assert.equal(resolveChannelDispatchMediaType("video"), "video");
  assert.equal(resolveChannelDispatchMediaType("images"), "images");
  assert.equal(resolveChannelDispatchMediaType("none"), "images");

  const route = read("app/api/booster/publish-now/route.ts");
  const dispatchStart = route.indexOf("const channelMediaMode =");
  const dispatchEnd = route.indexOf("return {", dispatchStart);
  const dispatchPayload = route.slice(dispatchStart, dispatchEnd);

  assert.match(dispatchPayload, /mediaType:\s*channelMediaType/);
  assert.match(
    dispatchPayload,
    /video:\s*channelMediaMode === "video" \? channelDispatchVideo : null/,
  );
  assert.match(
    dispatchPayload,
    /channelMediaMode === "images"[\s\S]{0,120}preparedImagesByChannel\[channel\]/,
  );
  assert.doesNotMatch(dispatchPayload, /\n\s*mediaType,\s*\n/);
});

test("une préparation mixte ne redescend jamais à la tentative zéro", () => {
  assert.equal(normalizeAsyncPreparationAttempt(0), 1);
  assert.equal(normalizeAsyncPreparationAttempt(1), 1);
  assert.equal(normalizeAsyncPreparationAttempt(2), 2);
  assert.equal(normalizeAsyncPreparationAttempt("3"), 3);
  assert.equal(normalizeAsyncPreparationAttempt("invalide"), 1);

  const route = read("app/api/booster/publish-now/route.ts");
  assert.match(
    route,
    /preparationAttempt:\s*normalizeAsyncPreparationAttempt\([\s\S]{0,80}body\._asyncPreparationAttempt/,
  );
  assert.doesNotMatch(
    route,
    /preparationAttempt:[\s\S]{0,140}requestedMediaChannels\.length[\s\S]{0,80}\?\s*0\s*:\s*1/,
  );
});

test("une publication mixte garde photos et vidéo groupées jusqu’à préparation complète", () => {
  const common = {
    internalAsyncPreparationDispatch: true,
    imageChannelCount: 3,
    videoChannelCount: 1,
  };
  assert.equal(
    shouldPrepareMixedMediaBeforeDispatch({ ...common, preparationAttempt: 1 }),
    true,
  );
  assert.equal(
    shouldPrepareMixedMediaBeforeDispatch({ ...common, preparationAttempt: 2 }),
    true,
  );
  assert.equal(
    shouldPrepareMixedMediaBeforeDispatch({ ...common, preparationAttempt: 3 }),
    true,
  );
});

test("l'attestation privée produit un payload vidéo qui franchit le préflight YouTube", () => {
  const attested = applyServerVideoFallbackAttestation(
    {
      name: "youtube.mp4",
      type: "video/mp4",
      size: 20_000_000,
      duration: 1,
      bucket: "client-bucket",
      storagePath: "client/path.mp4",
      publicUrl: "https://client.invalid/video.mp4",
      sourceMetadata: { compatibilityProof: "client_claim" },
    },
    {
      bucket: privateBucket,
      storagePath: privatePath,
      publicUrl: "https://storage.example/server-signed-video.mp4?token=server",
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
    },
  );

  assert.equal(attested.bucket, privateBucket);
  assert.equal(attested.storagePath, privatePath);
  assert.match(attested.publicUrl, /server-signed-video/);
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

  const route = read("app/api/booster/publish-now/route.ts");
  const dispatchStart = route.indexOf("const channelDispatchRequest =");
  const dispatchEnd = route.indexOf("return {", dispatchStart);
  const dispatchPayload = route.slice(dispatchStart, dispatchEnd);
  assert.match(
    dispatchPayload,
    /video:\s*channelMediaMode === "video" \? channelDispatchVideo : null/,
  );
  assert.match(
    dispatchPayload,
    /_asyncTrustedVideoCompatibilityProof:[\s\S]{0,100}channelMediaMode === "video"[\s\S]{0,100}hasTrustedPublicationVideoCompatibilityProof/,
  );
  const youtubeStart = route.indexOf('if (ch === "youtube_shorts")');
  const youtubeEnd = route.indexOf('if (ch === "tiktok")', youtubeStart);
  const youtubeWorker = route.slice(youtubeStart, youtubeEnd);
  assert.match(
    youtubeWorker,
    /const youtubeDuration = Number\(channelVideo\.duration \|\| 0\)/,
  );
  assert.match(youtubeWorker, /validateVideoDurationForChannel\(/);
  assert.match(
    youtubeWorker,
    /createYoutubeResumableUploadCheckpoint\([\s\S]{0,80}youtubeUploadInput/,
  );
});

test("le probe charge l'ownership uploadé avant de signer le bucket privé réel", () => {
  const server = read("lib/boosterVideoVariantServer.ts");
  const probeStart = server.indexOf(
    "export async function probeStoredBoosterVideoForPublication",
  );
  const probeEnd = server.indexOf(
    "function getVideoSafetyBackgroundColor",
    probeStart,
  );
  const probe = server.slice(probeStart, probeEnd);

  assert.match(server, /\.eq\("user_id", params\.accountId\)/);
  assert.match(server, /\.eq\("media_type", "video"\)/);
  assert.match(server, /\.eq\("upload_status", "uploaded"\)/);
  assert.ok(
    probe.indexOf("loadBoosterVideoProbeRegistryRow") <
      probe.indexOf("createSafeStorageSignedUrl"),
  );
  assert.match(
    probe,
    /createSafeStorageSignedUrl\(\s*authorization\.bucket,\s*authorization\.storagePath/,
  );
  assert.doesNotMatch(probe, /params\.publicUrl|params\.url|params\.duration/);
});
