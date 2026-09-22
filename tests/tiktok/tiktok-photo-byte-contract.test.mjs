import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require(process.env.INRCY_TEST_SHARP_PATH || "sharp");

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

function extractFunction(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${name} must end before ${nextName}`);
  return source
    .slice(start, end)
    .replace(/([,(]\s*[a-zA-Z_$][\w$]*)\s*:\s*(?:Buffer|string|number|boolean)/g, "$1");
}

async function loadRoutePhotoCodec() {
  const source = await read("app/api/media/tiktok/route.ts");
  const render = extractFunction(
    source,
    "renderTikTokRatioPreservingJpeg",
    "renderTikTokSafetyFrame",
  );
  const validate = extractFunction(
    source,
    "isDirectTikTokPhotoPublishable",
    "toTikTokPhotoBuffer",
  );
  const factory = new Function(
    "sharp",
    "TIKTOK_PHOTO_MAX_BYTES",
    "TIKTOK_LANDSCAPE_MAX_WIDTH",
    "TIKTOK_LANDSCAPE_MAX_HEIGHT",
    "TIKTOK_PORTRAIT_MAX_WIDTH",
    "TIKTOK_PORTRAIT_MAX_HEIGHT",
    `${render}\n${validate}\nreturn { renderTikTokRatioPreservingJpeg, isDirectTikTokPhotoPublishable };`,
  );
  return factory(sharp, 20_000_000, 1920, 1080, 1080, 1920);
}

test("TikTok PHOTO route emits baseline sRGB 4:2:0 JPEG bytes", async () => {
  const codec = await loadRoutePhotoCodec();
  const progressiveInput = await sharp({
    create: {
      width: 2100,
      height: 1400,
      channels: 4,
      background: { r: 38, g: 126, b: 214, alpha: 0.72 },
    },
  })
    .jpeg({ quality: 95, progressive: true, chromaSubsampling: "4:4:4" })
    .toBuffer();

  assert.equal(
    await codec.isDirectTikTokPhotoPublishable(progressiveInput, "image/jpeg"),
    false,
  );

  const output = await codec.renderTikTokRatioPreservingJpeg(progressiveInput);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.notEqual(metadata.isProgressive, true);
  assert.equal(metadata.space, "srgb");
  assert.equal(metadata.chromaSubsampling, "4:2:0");
  assert.ok(output.length <= 20_000_000);
  assert.ok((metadata.width || 0) <= 1920);
  assert.ok((metadata.height || 0) <= 1080);
  assert.equal(
    await codec.isDirectTikTokPhotoPublishable(output, "image/jpeg"),
    true,
  );
});

test("TikTok PHOTO guard trusts neither WebP nor a declared JPEG MIME", async () => {
  const codec = await loadRoutePhotoCodec();
  const webp = await sharp({
    create: {
      width: 720,
      height: 1280,
      channels: 3,
      background: { r: 220, g: 80, b: 120 },
    },
  })
    .webp()
    .toBuffer();
  assert.equal(
    await codec.isDirectTikTokPhotoPublishable(webp, "image/webp"),
    false,
  );
  assert.equal(
    await codec.isDirectTikTokPhotoPublishable(webp, "image/jpeg"),
    false,
  );
});

test("all TikTok image exits use the new immutable byte contract", async () => {
  const route = await read("app/api/media/tiktok/route.ts");
  const booster = await read("lib/boosterImageServerPreparation.ts");
  const publish = await read("lib/tiktokPublish.ts");

  assert.match(route, /TIKTOK_READY_CACHE_VERSION = 3/);
  assert.doesNotMatch(route, /progressive:\s*true/);
  assert.match(route, /meta\.format !== "jpeg"/);
  assert.match(route, /meta\.isProgressive === true/);
  assert.match(route, /meta\.chromaSubsampling/);
  assert.match(booster, /TIKTOK_CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 11/);
  assert.match(booster, /tiktok:\s*new Set\(\)/);
  assert.match(booster, /await ensureTikTokPhotoContract\(variant\.output\)/);
  assert.match(publish, /media_type:\s*"PHOTO"/);
  assert.match(publish, /getTiktokUserFacingError\(response\.error, "photo"\)/);
});
