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
    imageUrl: "https://example.com/meta-feed.jpg",
    metaCreativeAssets: {
      feedImageUrl: "https://example.com/meta-feed.jpg",
      storyReelImageUrl: "",
    },
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
  assert.equal(unsupportedAdsConnectorReason({ ...meta, metaPlacements: ["facebook_feed"] }), null);
  assert.equal(unsupportedAdsConnectorReason({
    ...meta,
    metaPlacements: ["stories", "reels"],
    imageUrl: "",
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "https://example.com/meta-story.jpg" },
  }), null);
  assert.equal(unsupportedAdsConnectorReason({
    ...meta,
    metaPlacements: ["facebook_feed", "instagram_feed", "stories", "reels"],
    metaCreativeAssets: {
      feedImageUrl: "https://example.com/meta-feed.jpg",
      storyReelImageUrl: "https://example.com/meta-story.jpg",
    },
  }), null);
  assert.match(unsupportedAdsConnectorReason({
    ...meta,
    metaPlacements: ["facebook_feed", "stories"],
  }) || "", /Story\/Reel 9:16/);
  assert.match(unsupportedAdsConnectorReason({
    ...meta,
    metaPlacements: ["facebook_feed"],
    imageUrl: "",
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "" },
  }) || "", /Feed 4:5/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, metaPlacements: ["messenger"] }) || "", /pas Messenger/);
  assert.match(unsupportedAdsConnectorReason({ ...meta, metaPlacements: [] }) || "", /au moins un placement/);
  assert.equal(unsupportedAdsConnectorReason({
    ...meta,
    metaCreativeAssets: undefined,
  }), null, "un ancien brouillon Feed garde imageUrl comme repli");
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
  const metaCore = readFileSync(new URL("../lib/adsMetaPublishCore.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(google, /if \(options\.activate === false\) return paused;/);
  assert.match(meta, /activate: shouldActivate/);
  assert.match(metaCore, /if \(!input\.activate\) \{/);
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

test("un préflight Meta refusé reste corrigeable sans autoriser un doublon après mutation", () => {
  const meta = readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");

  assert.match(meta, /onProviderMutationStart\?: \(\) => void/);
  assert.ok(
    meta.indexOf("options.onProviderMutationStart?.();") < meta.indexOf("return executeMetaAdsGraphPublish({"),
    "la frontière doit être signalée juste avant la séquence de mutations Graph",
  );
  assert.match(route, /let metaProviderMutationStarted = false/);
  assert.match(route, /onProviderMutationStart: \(\) => \{ metaProviderMutationStarted = true; \}/);
  assert.match(route, /const metaRejectedBeforeCreate = draft\.provider === "meta" && !metaProviderMutationStarted[\s\S]*?Object\.keys\(resources\)\.length === 0/);
  assert.match(route, /status: rejectedBeforeCreate \? "draft" : "needs_review"/);
  assert.match(route, /provider_resources: rejectedBeforeCreate \? \{\} : resources/);
  assert.match(route, /const rejectedBeforeCreate = googleRejectedBeforeCreate \|\| metaRejectedBeforeCreate/);
});

test("le connecteur Search transmet les réseaux Google choisis dans le studio", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.match(google, /targetSearchNetwork: draft\.googleSearchPartners/);
  assert.doesNotMatch(google, /targetPartnerSearchNetwork:\s*draft\.googleSearchPartners/);
  assert.match(google, /targetContentNetwork: draft\.googleDisplayExpansion/);
});

test("le connecteur Search vérifie les zones saisies avant toute mutation", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(google, /geo_target_constant\.canonical_name/);
  assert.match(google, /draft\.targetLocations/);
  assert.match(google, /locationCriterionResourceNames/);
  assert.match(google, /resolveGoogleTargetLocations\(/);
  assert.match(google, /countryCode: "FR"/);
  assert.match(google, /coveredByFrance/);
  assert.match(route, /code: error\.code, error: error\.message \}, \{ status: 422 \}/);
  assert.ok(route.indexOf("preparedGoogleTargetLocations = await resolveGoogleTargetLocations(") < route.indexOf('supabaseAdmin.rpc("inrcy_claim_ads_draft_for_publish"'));
  assert.match(route, /preparedTargetLocations: preparedGoogleTargetLocations/);
});

test("la confirmation de démo impose la déclaration avant l'enregistrement local", () => {
  const dialog = readFileSync(new URL("../app/dashboard/ads/AdsCampaignDemoDialog.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  assert.match(dialog, /checked=\{declarationChecked\}/);
  assert.match(dialog, /disabled=\{busy \|\| !declarationChecked\}/);
  assert.match(client, /parseAdsCampaignInput\(campaignDraft, \{ purpose: "publish" \}\)/);
  assert.ok(client.indexOf('parseAdsCampaignInput(campaignDraft, { purpose: "publish" })') < client.indexOf('const saved = await readJson(await fetch("/api/ads/campaigns"'));
});

test("les validations bloquantes restent près des actions, les descriptions alignées avec les titres", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
  const destinationReview = client.slice(client.indexOf("{destinationReview.required && <div"), client.indexOf("{nativeSettings?.channel === \"tiktok\"", client.indexOf("{destinationReview.required && <div")));
  const navigation = client.slice(client.indexOf("{creationPath !== \"choice\" && <div className={styles.wizardNavigation}"));
  const finalActions = client.slice(client.indexOf("<div className={styles.studioFinalActions}"), client.indexOf("</section>", client.indexOf("<div className={styles.studioFinalActions}")));

  assert.doesNotMatch(destinationReview, /type="checkbox"/);
  assert.match(navigation, /wizardNextGroup[\s\S]*?wizardRequiredCheck[\s\S]*?Je confirme ce lien[\s\S]*?Suivant →/);
  assert.match(finalActions, /studioRequiredCheck[\s\S]*?Obligatoire avant création sur Google Ads[\s\S]*?Créer une démo en pause/);
  assert.match(css, /\.googleAdCopyField\{[^}]*align-self:start;align-content:start/);
});

test("le connecteur Search n'ajoute plus de ciblage linguistique manuel mais garde les exclusions", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.doesNotMatch(google, /language_constant\.code/);
  assert.doesNotMatch(google, /resolveGoogleTargetLanguages\(/);
  assert.doesNotMatch(google, /language: \{ languageConstant:/);
  assert.match(google, /languageCriterionResourceNames: \[\]/);
  assert.match(google, /negative: true,[\s\S]*?matchType: "BROAD"/);
  assert.match(google, /negativeKeywordCriterionResourceNames/);
  assert.match(google, /const adGroupOffset = 2 \+ targetLocations\.length \+ draft\.negativeKeywords\.length/);
  assert.match(google, /resourceNameAt\(created, 2 \+ targetLocations\.length \+ index, "campaignCriterionResult"/);
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
  const core = readFileSync(new URL("../lib/adsMetaPublishCore.ts", import.meta.url), "utf8");
  assert.match(meta, /verifyMediaLibraryContentToken/);
  assert.match(meta, /createSafeStorageSignedUrl/);
  assert.match(meta, /resolveMetaImageUrl/);
  assert.match(meta, /downloadMetaImageBytes/);
  assert.match(core, /\/adimages/);
  assert.match(core, /asset_feed_spec/);
});
