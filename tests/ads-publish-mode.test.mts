import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADS_LIVE_PUBLISH_CONFIRMATION,
  ADS_PAUSED_DEMO_CONFIRMATION,
  hasAdsPublishConfirmation,
  isAdsPublishModeEnabled,
  parseAdsPublishMode,
} from "../lib/adsPublishMode.ts";

test("la démo Ads reste distincte de la publication réelle", () => {
  assert.equal(parseAdsPublishMode("demo_paused"), "demo_paused");
  assert.equal(parseAdsPublishMode("anything-else"), "live");
  assert.equal(isAdsPublishModeEnabled("demo_paused", { INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED: "true" }), true);
  assert.equal(isAdsPublishModeEnabled("demo_paused", { INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" }), false);
  assert.equal(isAdsPublishModeEnabled("live", { INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED: "true" }), false);
  assert.equal(hasAdsPublishConfirmation("demo_paused", ADS_PAUSED_DEMO_CONFIRMATION), true);
  assert.equal(hasAdsPublishConfirmation("demo_paused", ADS_LIVE_PUBLISH_CONFIRMATION), false);
  assert.equal(hasAdsPublishConfirmation("live", ADS_LIVE_PUBLISH_CONFIRMATION), true);
});

test("les adaptateurs Google et Meta s’arrêtent avant toute activation en mode démo", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const meta = readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(google, /if \(options\.activate === false\) return paused;/);
  assert.match(meta, /if \(!shouldActivate\) \{/);
  assert.match(route, /status: pausedDemo \? "demo_paused" : "active"/);
  assert.match(route, /activate: !pausedDemo/);
});
