import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADS_LIVE_PUBLISH_CONFIRMATION,
  ADS_PAUSED_DEMO_CONFIRMATION,
  hasAdsPublishConfirmation,
  isAdsPublishModeEnabled,
  parseAdsPublishMode,
  unsupportedAdsConnectorReason,
  googleSearchBiddingFields,
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

test("le serveur refuse les formats que les connecteurs Google et Meta ne savent pas publier", () => {
  const meta = {
    provider: "meta",
    campaignType: "meta_traffic",
    objective: "website_traffic",
    conversionGoal: "website_visit",
    conversionLocation: "website",
    metaPlacements: ["facebook_feed", "instagram_feed"],
    callToAction: "En savoir plus",
    mediaStrategy: "image",
    creativeType: "image",
    bidStrategy: "maximize_conversions",
  } as Parameters<typeof unsupportedAdsConnectorReason>[0];

  assert.equal(unsupportedAdsConnectorReason({ ...meta, provider: "google", campaignType: "search" }), null);
  assert.match(unsupportedAdsConnectorReason({ ...meta, provider: "google", campaignType: "performance_max" }) || "", /Réseau de recherche/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, provider: "google", campaignType: "search", bidStrategy: "target_roas" }) || "", /CPA\/ROAS/);
  assert.equal(unsupportedAdsConnectorReason(meta), null);
  assert.match(unsupportedAdsConnectorReason({ ...meta, campaignType: "meta_leads" }) || "", /Trafic/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, conversionLocation: "instant_form" }) || "", /site web/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, conversionGoal: "quote_request" }) || "", /visites/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, metaPlacements: ["facebook_feed", "stories"] }) || "", /fils Facebook et Instagram/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, metaPlacements: ["facebook_feed"] }) || "", /fils Facebook et Instagram/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, callToAction: "" }) || "", /En savoir plus/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, callToAction: "Demander un devis" }) || "", /En savoir plus/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, mediaStrategy: "video" }) || "", /image/);

  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(route, /code: "ADS_CONNECTOR_UNSUPPORTED_CONFIGURATION"[\s\S]*?status: 422/);
  assert.ok(route.indexOf("unsupportedAdsConnectorReason(draft)") < route.indexOf("listAdsAccounts(user.activeUserId, draft.provider)"));
  assert.ok(route.indexOf("unsupportedAdsConnectorReason(draft)") < route.indexOf('supabaseAdmin.rpc("inrcy_claim_ads_draft_for_publish"'));
  assert.ok(route.indexOf("listAdsAccounts(user.activeUserId, draft.provider)") < route.indexOf('supabaseAdmin.rpc("inrcy_claim_ads_draft_for_publish"'));
});

test("les enchères Search respectent la stratégie choisie sans substitution silencieuse", () => {
  assert.deepEqual(googleSearchBiddingFields("maximize_conversions"), { maximizeConversions: {} });
  assert.deepEqual(googleSearchBiddingFields("maximize_clicks"), { targetSpend: {} });
  assert.deepEqual(googleSearchBiddingFields("maximize_value"), { maximizeConversionValue: {} });
  assert.equal(googleSearchBiddingFields("target_cpa"), null);
  assert.equal(googleSearchBiddingFields("target_roas"), null);
  assert.equal(googleSearchBiddingFields("manual_review"), null);
});

test("les adaptateurs Google et Meta s’arrêtent avant toute activation en mode démo", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const meta = readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(google, /if \(options\.activate === false\) return paused;/);
  assert.match(meta, /if \(!shouldActivate\) \{/);
  assert.match(route, /status: pausedDemo \? "demo_paused" : "active"/);
  assert.match(route, /activate: !pausedDemo/);
  assert.match(route, /\.eq\("status", "publishing"\)\s*\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(route, /if \(error \|\| !data\) throw new Error\("Impossible d’enregistrer les identifiants de la plateforme publicitaire\."\)/);
  const progressStart = route.indexOf("const persistProgress = async");
  const progressHandler = route.slice(progressStart, route.indexOf("  try {", progressStart));
  assert.ok(progressHandler.indexOf("progress = resources;") >= 0);
  assert.ok(progressHandler.indexOf("progress = resources;") < progressHandler.indexOf('supabaseAdmin.from("ads_campaigns").update('));
  assert.match(route, /const resources = error instanceof MetaAdsPublishError \? error\.progress : progress/);
});

test("le connecteur Search transmet les réseaux Google choisis dans le studio", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /targetSearchNetwork: draft\.googleSearchPartners/);
  assert.doesNotMatch(google, /targetPartnerSearchNetwork:\s*draft\.googleSearchPartners/);
  assert.match(google, /targetContentNetwork: draft\.googleDisplayExpansion/);
});

test("le connecteur Search vérifie les zones saisies avant toute mutation", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /geo_target_constant\.canonical_name/);
  assert.match(google, /draft\.targetLocations/);
  assert.match(google, /locationCriterionResourceNames/);
  assert.match(google, /resolveGoogleTargetLocations\(/);
});

test("le connecteur Search publie aussi les langues et mots-clés à exclure", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /language_constant\.code/);
  assert.match(google, /resolveGoogleTargetLanguages\(/);
  assert.match(google, /language: \{ languageConstant: language\.resourceName \}/);
  assert.match(google, /negative: true,[\s\S]*?matchType: "BROAD"/);
  assert.match(google, /negativeKeywordCriterionResourceNames/);
  assert.match(google, /const adGroupOffset = 2 \+ targetLocations\.length \+ targetLanguages\.length \+ draft\.negativeKeywords\.length/);
});

test("les balises de suivi Google sont transmises comme suffixe d’URL, jamais ignorées", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /googleFinalUrlSuffix\(draft\.trackingParameters\)/);
  assert.match(google, /\.\.\.\(finalUrlSuffix \? \{ finalUrlSuffix \} : \{\}\)/);
});

test("le parcours iNrCy génère réellement le média de campagne via iNr’Studio", () => {
  const generator = readFileSync(
    new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url),
    "utf8",
  );
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const mediaPolicy = readFileSync(new URL("../lib/adsCampaignMediaPolicy.ts", import.meta.url), "utf8");

  assert.match(generator, /useMediaGeneration/);
  assert.match(generator, /source: "studio"/);
  assert.match(generator, /acceptDraft\(generated\)/);
  assert.match(generator, /cancelGeneration\(\)/);
  assert.match(generator, /search_text/);
  assert.match(mediaPolicy, /product_feed/);
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
