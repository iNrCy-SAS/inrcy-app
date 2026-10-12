import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BOOSTER_VIDEO_PREPARATION_KEYS } from "../../lib/boosterMediaPipelineMissions.ts";
import {
  INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "../../lib/mediaRules.ts";
import { validateVideoPublicationForChannel } from "../../lib/videoPublicationPolicy.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_VIDEO_BYTES = 75_000_000;
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("la source et la publication Booster sont plafonnées à 75 Mo", () => {
  assert.equal(INR_MEDIA_VIDEO_SOURCE_MAX_BYTES, MAX_VIDEO_BYTES);
  assert.equal(INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES, MAX_VIDEO_BYTES);
});

test("la vidéo originale acceptée reste publiable sur les canaux à 75 Mo", () => {
  for (const channel of [
    "facebook",
    "instagram",
    "linkedin",
    "tiktok",
    "youtube_shorts",
    "pinterest",
    "site_web",
    "inr_search",
  ] as const) {
    const result = validateVideoPublicationForChannel({
      channel,
      name: "original.mp4",
      type: "video/mp4",
      storagePath: "original.mp4",
      sizeBytes: MAX_VIDEO_BYTES,
      durationSeconds: 20,
      width: 1920,
      height: 1080,
    });
    assert.equal(result.ok, true, `${channel} doit accepter l'original à 75 Mo`);
  }
});

test("une vidéo dépassant 75 Mo est refusée avant publication", () => {
  const result = validateVideoPublicationForChannel({
    channel: "facebook",
    name: "original.mp4",
    type: "video/mp4",
    storagePath: "original.mp4",
    sizeBytes: MAX_VIDEO_BYTES + 1,
    durationSeconds: 20,
    width: 1920,
    height: 1080,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "video_too_large");
});

test("la mission publication possède un fallback canonique ciblé", () => {
  assert.deepEqual(BOOSTER_VIDEO_PREPARATION_KEYS.publication_preparation, [
    "canonical",
    "thumbnail",
  ]);
  assert.deepEqual(BOOSTER_VIDEO_PREPARATION_KEYS.ai_preparation, [
    "thumbnail",
    "frame_01",
    "frame_02",
    "frame_03",
    "audio_track",
  ]);
  const activeKeys = new Set<string>([
    ...BOOSTER_VIDEO_PREPARATION_KEYS.publication_preparation,
    ...BOOSTER_VIDEO_PREPARATION_KEYS.ai_preparation,
  ]);
  assert.equal(activeKeys.has("canonical"), true);
  assert.equal(activeKeys.has("ai_preview"), false);
});

test("les scripts SQL historiques restent immuables et la politique courante vit dans le runtime", () => {
  const sql = read(
    "ops/sql/2026-07-30_media_pipeline_step10_performance_hardening.sql",
  );
  const verify = read("ops/sql/2026-07-30_media_pipeline_step10_verify.sql");
  assert.match(sql, /40894464/);
  assert.match(verify, /40894464/);
  assert.doesNotMatch(sql, /313524224/);
  assert.doesNotMatch(verify, /313524224/);
});

test("les variantes explicites restent plafonnées par la politique globale", () => {
  const transforms = read("lib/boosterVideoTransforms.ts");
  assert.match(
    transforms,
    /maxOutputBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES/g,
  );
  assert.match(
    transforms,
    /maxOutputBytes: GOOGLE_BUSINESS_VIDEO_MAX_BYTES/,
  );
});
