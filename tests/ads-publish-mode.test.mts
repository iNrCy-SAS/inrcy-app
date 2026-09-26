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

test("le connecteur Search transmet les réseaux Google choisis dans le studio", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /targetPartnerSearchNetwork: draft\.googleSearchPartners/);
  assert.match(google, /targetContentNetwork: draft\.googleDisplayExpansion/);
});

test("le connecteur Search vérifie les zones saisies avant toute mutation", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /geo_target_constant\.canonical_name/);
  assert.match(google, /draft\.targetLocations/);
  assert.match(google, /locationCriterionResourceNames/);
  assert.match(google, /resolveGoogleTargetLocations\(/);
});

test("le parcours iNrCy génère réellement le média de campagne via iNr’Studio", () => {
  const generator = readFileSync(
    new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url),
    "utf8",
  );
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");

  assert.match(generator, /useMediaGeneration/);
  assert.match(generator, /source: "studio"/);
  assert.match(generator, /acceptDraft\(generated\)/);
  assert.match(generator, /cancelGeneration\(\)/);
  assert.match(generator, /search_text/);
  assert.match(generator, /product_feed/);
  assert.match(client, /<AdsCampaignAutoMediaGenerator/);
  assert.match(client, /iNr’Studio a généré et associé le média de cette campagne/);
});

test("un média privé iNrCy est transformé côté serveur en URL temporaire lisible par Meta", () => {
  const meta = readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8");
  assert.match(meta, /verifyMediaLibraryContentToken/);
  assert.match(meta, /createSafeStorageSignedUrl/);
  assert.match(meta, /resolveMetaImageUrl/);
  assert.match(meta, /imageUrl: metaImageUrl/);
});
