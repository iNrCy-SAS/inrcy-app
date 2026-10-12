import assert from "node:assert/strict";
import test from "node:test";

import { BOOSTER_PUBLICATION_CHANNELS, isBoosterPublicationChannel, normalizeBoosterPublicationChannels } from "../../lib/boosterPublicationPolicy.ts";
import { normalizeSiteWebChannelMap, normalizeSiteWebPublicationPayload, normalizeWidgetSource } from "../../lib/siteWebChannel.ts";
import { readBoosterGenerationRecoveryPayload } from "../../lib/boosterGenerationRecovery.ts";
import { buildVideoSettingsByChannel } from "../../lib/boosterVideoSettings.ts";

test("the active publication catalog exposes one website and legacy selections do not publish it twice", () => {
  assert.equal(BOOSTER_PUBLICATION_CHANNELS.filter((channel) => channel === "site_web").length, 1);
  assert.equal(isBoosterPublicationChannel("inrcy_site"), false);
  assert.deepEqual(normalizeBoosterPublicationChannels(["inrcy_site", "site_web", "facebook"]), {
    channels: ["site_web", "facebook"], invalidChannels: [],
  });
});

test("an old draft keeps its post, image and video assignments through the publication boundary", () => {
  const video = { storagePath: "client/video.mp4", publicUrl: "https://cdn.example/video.mp4" };
  const oldDraft = {
    channels: ["inrcy_site", "site_web"],
    postByChannel: { inrcy_site: { title: "Chantier", content: "Texte client" } },
    imagesByChannel: { inrcy_site: [{ imageKey: "original-image", url: "https://cdn.example/image.png" }] },
    videoByChannel: { inrcy_site: video },
    publishPayload: { mediaModeByChannel: { inrcy_site: "video" } },
  };
  const canonical = normalizeSiteWebPublicationPayload(oldDraft);
  assert.deepEqual(canonical.channels, ["site_web"]);
  assert.deepEqual((canonical.postByChannel as Record<string, unknown>).site_web, oldDraft.postByChannel.inrcy_site);
  assert.deepEqual((canonical.imagesByChannel as Record<string, unknown>).site_web, oldDraft.imagesByChannel.inrcy_site);
  assert.deepEqual((canonical.videoByChannel as Record<string, unknown>).site_web, video);
  assert.deepEqual(canonical.publishPayload, { mediaModeByChannel: { site_web: "video" } });
  assert.equal(oldDraft.channels[0], "inrcy_site");
});

test("the saved Site Web choice wins a collision while an empty placeholder keeps the prepared old post", () => {
  assert.deepEqual(normalizeSiteWebChannelMap({ site_web: { content: "Current" }, inrcy_site: { content: "Old" } }), { site_web: { content: "Current" } });
  assert.deepEqual(normalizeSiteWebChannelMap({ inrcy_site: { content: "Old" }, site_web: {} }), { site_web: { content: "Old" } });
});

test("a recovered old generation exposes the canonical channel without losing its text", () => {
  const recovered = readBoosterGenerationRecoveryPayload({
    boosterGenerationReceipt: { requestId: "generation_12345", status: "ready", recoveredChannels: ["inrcy_site", "site_web"] },
    postByChannel: { inrcy_site: { title: "Réalisation", content: "Article prêt" } },
  }, "generation_12345");
  assert.deepEqual(recovered?.versions, { site_web: { title: "Réalisation", content: "Article prêt" } });
  assert.deepEqual(recovered?.recoveredChannels, ["site_web"]);
});

test("saved website video adaptation survives the canonical channel switch", () => {
  assert.deepEqual(buildVideoSettingsByChannel({
    channels: ["site_web"],
    videoSettingsByChannel: { inrcy_site: { format: "16_9", adaptationMode: "safe_frame" } },
  }), { site_web: { format: "16_9", adaptationMode: "safe_frame" } });
});

test("old and current widget token sources target the same feed while unknown sources stay rejected", () => {
  assert.equal(normalizeWidgetSource("inrcy_site"), "site_web");
  assert.equal(normalizeWidgetSource("site_web"), "site_web");
  assert.equal(normalizeWidgetSource("facebook"), null);
  assert.equal(normalizeWidgetSource(undefined), null);
});
