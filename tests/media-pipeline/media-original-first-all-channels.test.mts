import assert from "node:assert/strict";
import test from "node:test";

import {
  getBoosterImageDecision,
  getBoosterImageSafetyBackgroundMode,
  type BoosterImageChannel,
} from "../../lib/boosterImageDecision.ts";
import {
  buildVideoSettingsByChannel,
  getDefaultChannelVideoSettings,
  getVideoPreviewAspectRatio,
  normalizeVideoAdaptationMode,
  type BoosterVideoChannelKey,
} from "../../lib/boosterVideoSettings.ts";
import { getVariantForChannel } from "../../lib/boosterVideoTransforms.ts";

const broadImageChannels: BoosterImageChannel[] = [
  "inrcy_site", "site_web", "inr_search", "gmb", "facebook",
  "linkedin", "x", "tiktok",
];
const videoChannels: BoosterVideoChannelKey[] = [
  "inrcy_site", "site_web", "inr_search", "gmb", "facebook",
  "instagram", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest",
];

test("portrait, square and landscape remain original on channels that accept them", () => {
  for (const channel of broadImageChannels) {
    for (const meta of [
      { width: 900, height: 1600 },
      { width: 1200, height: 1200 },
      { width: 1600, height: 900 },
    ]) {
      assert.equal(getBoosterImageDecision({ channel, meta }).mode, "original", channel);
    }
  }
});


test("Instagram and Pinterest preserve every ratio they accept and adapt only hard outliers", () => {
  for (const meta of [
    { width: 1080, height: 1350 },
    { width: 1200, height: 1200 },
    { width: 1910, height: 1000 },
  ]) {
    assert.equal(getBoosterImageDecision({ channel: "instagram", meta }).mode, "original");
  }
  assert.equal(
    getBoosterImageDecision({ channel: "instagram", meta: { width: 900, height: 1600 } }).mode,
    "adapted",
  );

  for (const meta of [
    { width: 1000, height: 1500 },
    { width: 1200, height: 1200 },
    { width: 1600, height: 900 },
  ]) {
    assert.equal(getBoosterImageDecision({ channel: "pinterest", meta }).mode, "original");
  }
  assert.equal(
    getBoosterImageDecision({ channel: "pinterest", meta: { width: 900, height: 1800 } }).mode,
    "adapted",
  );
});


test("safety backgrounds are solid or transparent, never blurred", () => {
  assert.equal(getBoosterImageSafetyBackgroundMode("inrcy_site"), "transparent");
  assert.equal(getBoosterImageSafetyBackgroundMode("site_web"), "transparent");
  assert.equal(getBoosterImageSafetyBackgroundMode("gmb"), "white");
  assert.equal(getBoosterImageSafetyBackgroundMode("instagram"), "black");
  assert.equal(getBoosterImageSafetyBackgroundMode("x"), "black");
  assert.equal(getBoosterImageSafetyBackgroundMode("pinterest"), "black");
});

test("stale transforms cannot personalize an image without explicit provenance", () => {
  const decision = getBoosterImageDecision({
    channel: "facebook",
    meta: { width: 900, height: 1600 },
    currentTransform: { fit: "contain", backgroundColor: "#ffffff" },
    automaticTransform: { fit: "cover", backgroundMode: "black" },
  });
  assert.equal(decision.mode, "original");
  assert.equal(decision.label, "Originale");
});

test("every video channel defaults to the original source", () => {
  for (const channel of videoChannels) {
    assert.equal(getDefaultChannelVideoSettings(channel, { width: 1080, height: 1920 }).format, "original");
  }
  const settings = buildVideoSettingsByChannel({ channels: videoChannels });
  for (const channel of videoChannels) assert.equal(settings[channel]?.format, "original");
});


test("Original video previews keep the source ratio instead of forcing 16:9", () => {
  assert.equal(
    getVideoPreviewAspectRatio("original", { width: 1080, height: 1920 }),
    "1080 / 1920",
  );
  assert.equal(getVideoPreviewAspectRatio("1_1", { width: 1080, height: 1920 }), "1 / 1");
});

test("an old channel crop is never reused for an Original request", () => {
  const oldVariant = {
    key: "facebook-16-9", channel: "facebook" as const, format: "16_9" as const,
    adaptationMode: "safe_frame" as const, target: { format: "16_9" as const, width: 1280, height: 720, aspectRatio: "16:9", label: "16:9" },
    signature: "16_9:safe_frame", storagePath: "old.mp4", publicUrl: "https://example.test/old.mp4",
    contentType: "video/mp4", size: 100, duration: 10, generatedAt: new Date(0).toISOString(),
  };
  assert.equal(getVariantForChannel([oldVariant], "facebook", "original", "safe_frame"), null);
});

test("legacy blurred video settings are migrated to a solid safe frame", () => {
  assert.equal(normalizeVideoAdaptationMode("safe_blur"), "safe_frame");
  assert.equal(normalizeVideoAdaptationMode(undefined), "safe_frame");
});
