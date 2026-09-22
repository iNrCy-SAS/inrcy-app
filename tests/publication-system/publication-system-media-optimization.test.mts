import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BOOSTER_VIDEO_PREPARATION_KEYS } from "../../lib/boosterMediaPipelineMissions.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("le pipeline Booster produit uniquement le fallback canonique nécessaire", () => {
  assert.deepEqual(BOOSTER_VIDEO_PREPARATION_KEYS.publication_preparation, [
    "canonical",
    "thumbnail",
  ]);
  assert.equal(
    BOOSTER_VIDEO_PREPARATION_KEYS.ai_preparation.includes("canonical" as never),
    false,
  );
  const normalizer = read("lib/mediaVideoNormalizer.ts");
  assert.match(normalizer, /prepareCanonical/);
  assert.match(normalizer, /libx264/);
  assert.doesNotMatch(normalizer, /Compression des médias/);
  assert.match(normalizer, /extractFrame/);
  assert.match(normalizer, /extractAudioTrack/);
});

test("l'original compatible reste original et seules les adaptations explicites utilisent FFmpeg", () => {
  const server = read("lib/boosterVideoVariantServer.ts");
  assert.match(
    server,
    /variant\.format === "original"[\s\S]*sourceCanPublishDirectly/,
  );
  assert.match(server, /CHANNEL_VIDEO_VARIANT_PIPELINE_VERSION = 7/);
  assert.match(server, /runFfmpegVariant/);
  assert.doesNotMatch(server, /requiresSocialOptimization/);
});

test("les images utilisent MozJPEG et invalident le cache de publication", () => {
  const normalizer = read("lib/mediaImageNormalizer.ts");
  const server = read("lib/boosterImageServerPreparation.ts");
  assert.match(normalizer, /mozjpeg: !providerSafe/);
  assert.match(normalizer, /optimiseScans: !providerSafe/);
  assert.match(server, /CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 9/);
  assert.match(server, /TIKTOK_CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 11/);
  assert.match(server, /function getChannelJpegOptions/);
  assert.match(server, /quality = 87/);
  assert.match(server, /progressive: false/);
  assert.match(server, /compressionLevel: 9/);
});
