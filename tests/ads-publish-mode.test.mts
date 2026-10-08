import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  ADS_LIVE_PUBLISH_CONFIRMATION,
  ADS_PAUSED_DEMO_CONFIRMATION,
  ADS_PAUSED_PUBLISH_CONFIRMATION,
  hasAdsPublishConfirmation,
  isAdsPublishModeEnabled,
  isAdsChannelPublishEnabled,
  parseAdsPublishMode,
  unsupportedAdsConnectorReason,
  googleSearchBiddingFields,
} from "../lib/adsPublishMode.ts";

test("approved Google and Pinterest publish independently while pilot channels stay gated", () => {
  for (const channel of ["google", "pinterest"]) {
    assert.equal(isAdsChannelPublishEnabled(channel, "live", {}), true);
    assert.equal(isAdsChannelPublishEnabled(channel, "paused", {}), true);
  }
  assert.equal(isAdsChannelPublishEnabled("google", "live", { INRCY_GOOGLE_ADS_PUBLISH_ENABLED: "false" }), false);
  assert.equal(isAdsChannelPublishEnabled("pinterest", "live", { INRCY_PINTEREST_ADS_PUBLISH_ENABLED: "false" }), false);
  for (const channel of ["meta", "linkedin", "x", "tiktok"]) {
    assert.equal(isAdsChannelPublishEnabled(channel, "live", {}), false);
  }
});

test("la démo Ads reste distincte de la publication réelle", () => {
  assert.equal(parseAdsPublishMode("demo_paused"), "demo_paused");
  assert.equal(parseAdsPublishMode("paused"), "paused");
  assert.equal(parseAdsPublishMode("anything-else"), "live");
  assert.equal(isAdsPublishModeEnabled("demo_paused", { INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED: "true" }), true);
  assert.equal(isAdsPublishModeEnabled("demo_paused", { INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" }), false);
  assert.equal(isAdsPublishModeEnabled("live", { INRCY_ADS_DEMO_PAUSED_PUBLISH_ENABLED: "true" }), false);
  assert.equal(isAdsPublishModeEnabled("paused", { INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" }), true);
  assert.equal(hasAdsPublishConfirmation("demo_paused", ADS_PAUSED_DEMO_CONFIRMATION), true);
  assert.equal(hasAdsPublishConfirmation("demo_paused", ADS_LIVE_PUBLISH_CONFIRMATION), false);
  assert.equal(hasAdsPublishConfirmation("live", ADS_LIVE_PUBLISH_CONFIRMATION), true);
  assert.equal(hasAdsPublishConfirmation("paused", ADS_PAUSED_PUBLISH_CONFIRMATION), true);
  assert.equal(hasAdsPublishConfirmation("paused", ADS_PAUSED_DEMO_CONFIRMATION), false);
});

test("le serveur refuse les formats que les connecteurs Google, Meta et Pinterest ne savent pas publier", () => {
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
  const pinterest = {
    ...meta,
    provider: "pinterest",
    campaignType: "generic",
    creativeUrl: "https://example.com/pin.jpg",
    channelSettings: {
      schemaVersion: 1,
      channel: "pinterest",
      objectiveType: "CONSIDERATION",
      intendedPromotionType: "STANDARD_AD",
      creativeType: "REGULAR",
      targetingMode: "automatic",
      conversionEvent: null,
    },
  } as Parameters<typeof unsupportedAdsConnectorReason>[0];
  assert.equal(unsupportedAdsConnectorReason(pinterest), null);
  assert.match(unsupportedAdsConnectorReason({ ...pinterest, keywords: ["idée cadeau"] }) || "", /mots-clés/i);
  assert.match(unsupportedAdsConnectorReason({
    ...pinterest,
    channelSettings: {
      schemaVersion: 1,
      channel: "pinterest",
      objectiveType: "CONSIDERATION",
      intendedPromotionType: "STANDARD_AD",
      creativeType: "REGULAR",
      targetingMode: "keywords",
      conversionEvent: null,
    },
  } as Parameters<typeof unsupportedAdsConnectorReason>[0]) || "", /mots-clés/);
  const unsupportedPinterest = {
    ...pinterest,
    channelSettings: {
      schemaVersion: 1,
      channel: "pinterest",
      objectiveType: "SALES",
      intendedPromotionType: "STANDARD_AD",
      creativeType: "REGULAR",
      targetingMode: "automatic",
      conversionEvent: "CHECKOUT",
    },
  } as Parameters<typeof unsupportedAdsConnectorReason>[0];
  assert.match(unsupportedAdsConnectorReason(unsupportedPinterest) || "", /Notoriété et Considération/);

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

test("les adaptateurs Google, Meta et Pinterest s’arrêtent avant toute activation en statut Paused", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const meta = readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8");
  const metaCore = readFileSync(new URL("../lib/adsMetaPublishCore.ts", import.meta.url), "utf8");
  const pinterest = readFileSync(new URL("../lib/adsPinterestCampaignPublish.ts", import.meta.url), "utf8");
  const pinterestContract = readFileSync(new URL("../lib/adsPinterestPublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(google, /if \(options\.activate === false\) return paused;/);
  assert.match(meta, /prepareMetaAdsPublication\(userId, draft, options\.activate !== false\)/);
  assert.match(metaCore, /if \(!input\.activate\) \{/);
  assert.match(pinterest, /if \(options\.activate !== false\)/);
  assert.match(pinterest, /stage: "paused"/);
  assert.match(pinterest, /buildPinterestActivationSteps/);
  assert.ok(pinterestContract.indexOf('stage: "ad_activated"') < pinterestContract.indexOf('stage: "ad_group_activated"'));
  assert.ok(pinterestContract.indexOf('stage: "ad_group_activated"') < pinterestContract.indexOf('stage: "active"'));
  assert.match(pinterest, /buildPinterestAdOnlyPinBody/);
  assert.match(route, /const completedStatus = pausedDemo \? "demo_paused" : pausedLaunch \? "paused" : "active"/);
  assert.match(route, /activate: !createPaused/);
  assert.match(route, /\.eq\("status", "publishing"\)\s*\.select\("id"\)\.maybeSingle\(\)/);
  assert.match(route, /if \(error \|\| !data\) throw new Error\("Impossible d’enregistrer les identifiants de la plateforme publicitaire\."\)/);
  const progressStart = route.indexOf("const persistProgress = async");
  const progressHandler = route.slice(progressStart, route.indexOf("  try {", progressStart));
  assert.ok(progressHandler.indexOf("progress = resources;") >= 0);
  assert.ok(progressHandler.indexOf("progress = resources;") < progressHandler.indexOf('supabaseAdmin.from("ads_campaigns").update('));
  assert.match(route, /error instanceof MetaAdsPublishError \|\| error instanceof PinterestAdsPublishError[\s\S]*?error\.progress : progress/);
});

test("un préflight Meta, Pinterest ou LinkedIn refusé reste corrigeable sans autoriser un doublon après mutation", () => {
  const meta = readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8");
  const pinterest = readFileSync(new URL("../lib/adsPinterestCampaignPublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");

  assert.match(meta, /onProviderMutationStart\?: \(\) => void/);
  assert.ok(
    meta.indexOf("options.onProviderMutationStart?.();") < meta.indexOf("return executeMetaAdsGraphPublish(input,"),
    "la frontière doit être signalée juste avant la séquence de mutations Graph",
  );
  assert.match(route, /let metaProviderMutationStarted = false/);
  assert.match(route, /onProviderMutationStart: \(\) => \{ metaProviderMutationStarted = true; \}/);
  assert.match(route, /const metaRejectedBeforeCreate = draft\.provider === "meta" && !metaProviderMutationStarted[\s\S]*?Object\.keys\(resources\)\.length === 0/);
  assert.match(route, /status: rejectedBeforeCreate \? "draft" : "needs_review"/);
  assert.match(route, /provider_resources: rejectedBeforeCreate \? \{\} : withInitialPublishRecovery\(resources, mode\)/);
  assert.match(pinterest, /onProviderMutationStart\?: \(\) => void/);
  assert.ok(
    pinterest.indexOf("options.onProviderMutationStart?.();") < pinterest.indexOf("return pinterestAdsRequest(accessToken, path, method, body);"),
    "la frontière Pinterest doit être signalée juste avant la première mutation fournisseur",
  );
  assert.match(route, /let pinterestProviderMutationStarted = false/);
  assert.match(route, /onProviderMutationStart: \(\) => \{ pinterestProviderMutationStarted = true; \}/);
  assert.match(route, /const pinterestRejectedBeforeCreate = draft\.provider === "pinterest"[\s\S]*?Object\.keys\(resources\)\.length === 0/);
  assert.match(route, /const linkedinRejectedBeforeCreate = draft\.provider === "linkedin"\s*&& \(error instanceof LinkedInAdsPublishError \? error\.retrySafe : !linkedinProviderMutationStarted\)\s*&& !hasLinkedInAdsPublicationResources\(resources\)/);
  assert.match(route, /const openaiRejectedBeforeCreate = draft\.provider === "openai" && openaiDraftRetrySafe/);
  assert.match(route, /const rejectedBeforeCreate = googleRejectedBeforeCreate \|\| metaRejectedBeforeCreate\s*\|\| pinterestRejectedBeforeCreate \|\| linkedinRejectedBeforeCreate \|\| openaiRejectedBeforeCreate;/);
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

test("la confirmation finale impose la déclaration, un statut disponible et la validation avant de réenregistrer ou publier", async () => {
  const dialog = readFileSync(new URL("../app/dashboard/ads/AdsCampaignDemoDialog.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  assert.match(dialog, /checked=\{declarationChecked\}/);
  assert.match(dialog, /disabled=\{busy \|\| !declarationChecked \|\| \(launchStatus === "active" \? !activeEnabled : !pausedEnabled\)\}/);
  assert.match(dialog, /Statut au lancement/);
  const source = ts.createSourceFile("AdsClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findHandler = (node: ts.Node): ts.FunctionDeclaration | undefined => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "confirmCampaignLaunch") return node;
    return ts.forEachChild(node, findHandler);
  };
  const handler = findHandler(source);
  assert.ok(handler);
  const confirmSource = handler.getText(source);
  const validation = confirmSource.indexOf('parseAdsCampaignInput(campaignDraft, { purpose: "publish" })');
  const save = confirmSource.indexOf('const saved = await readJson(await fetch("/api/ads/campaigns"');
  assert.ok(validation >= 0 && save > validation, "the final confirmation validates before its own local save");

  const calls: string[] = [];
  const noop = () => {};
  const scope = {
    demoDialog: { mode: "confirm", channelId: "google", launchStatus: "active", details: { accountId: "123456" } },
    busy: null, demoSubmissionRef: { current: false }, channelId: "google", creating: true,
    step: 10, validationStep: 10, channelPublishingEnabled: true, draft: { pageId: "" },
    setPublicationPhase: noop, setBusy: noop, setNotice: noop, setDemoDialog: noop,
    parseAdsCampaignInput: (_draft: unknown, options: { purpose: string }) => {
      assert.equal(options.purpose, "publish");
      calls.push("validation");
      return { draft: null, error: "Campagne invalide" };
    },
    fetch: async () => { calls.push("network"); throw new Error("validation must stop every request"); },
    readJson: async (value: unknown) => value,
  };
  const compiled = ts.transpileModule(confirmSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const confirm = new Function(...Object.keys(scope), `${compiled}; return confirmCampaignLaunch;`)(...Object.values(scope));
  await confirm();
  assert.deepEqual(calls, ["validation"], "invalid drafts must not be saved or published after confirmation");
});

test("les validations bloquantes restent près des actions, les descriptions alignées avec les titres", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
  const destinationReview = client.slice(client.indexOf("{destinationReview.required && <div"), client.indexOf("{nativeSettings?.channel === \"tiktok\"", client.indexOf("{destinationReview.required && <div")));
  const navigation = client.slice(client.indexOf("{creationPath !== \"choice\" && <div className={styles.wizardNavigation}"));
  const finalActions = client.slice(client.indexOf("<div className={styles.studioFinalActions}"), client.indexOf("</section>", client.indexOf("<div className={styles.studioFinalActions}")));

  assert.doesNotMatch(destinationReview, /type="checkbox"/);
  assert.match(navigation, /wizardNextGroup[\s\S]*?wizardRequiredCheck[\s\S]*?Je confirme ce lien[\s\S]*?Suivant →/);
  assert.match(finalActions, /studioRequiredCheck[\s\S]*?Obligatoire avant création sur Google Ads[\s\S]*?studioFinalActionButtons[\s\S]*?Enregistrer en brouillon[\s\S]*?studioLaunchGuard[\s\S]*?Lancer la campagne/);
  assert.match(finalActions, /data-tooltip=\{launchBlocked \? launchBlockingMessage : undefined\}/);
  assert.match(finalActions, /studioLaunchWarning[\s\S]*?⚠/);
  assert.match(css, /\.googleAdCopyField\{[^}]*align-self:start;align-content:start/);
  assert.match(css, /\.studioFinalActions \.studioRequiredCheck\{[^}]*width:100%;max-width:none/);
  assert.match(css, /\.studioLaunchGuard\[data-blocked\]::after\{content:attr\(data-tooltip\)/);
});

test("le connecteur Search n'ajoute plus de ciblage linguistique manuel mais garde les exclusions", () => {
  const google = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  assert.doesNotMatch(google, /language_constant\.code/);
  assert.doesNotMatch(google, /resolveGoogleTargetLanguages\(/);
  assert.doesNotMatch(google, /language: \{ languageConstant:/);
  assert.match(google, /languageCriterionResourceNames: \[\]/);
  assert.match(google, /negative: true,[\s\S]*?keyword: googleSearchKeyword\(keyword, deliverySettings\?\.negativeKeywordMatchType \|\| "BROAD"\)/);
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
