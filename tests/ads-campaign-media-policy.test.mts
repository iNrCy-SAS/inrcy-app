import { withUiCopy } from "./helpers/localized-ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessMetaCreativeAssetReadiness,
  adsMediaKindForPlan,
  adsMediaFormatForPlan,
  adsMediaStrategyAfterAttachment,
  CHATGPT_ADS_MAX_IMAGE_BYTES,
  CHATGPT_ADS_IMAGE_REQUIREMENTS,
  CHATGPT_ADS_MIN_IMAGE_SIDE_PX,
  chatgptAdsImagePrompt,
  GOOGLE_SEARCH_IMAGE_REQUIREMENTS,
  googleSearchImagePrompt,
  googleSearchImageSubjectPrompt,
  META_ADS_CREATIVE_SPECS,
  metaCreativeAssetReadinessReason,
  metaFeedImagePrompt,
  metaStoryReelImagePrompt,
  PINTEREST_ADS_IMAGE_SPEC,
  pinterestAdsImagePrompt,
  shouldGenerateAdsMedia,
} from "../lib/adsCampaignMediaPolicy.ts";
import { AI_MEDIA_FORMAT_SPECS } from "../lib/aiMediaGenerationContracts.ts";

test("Pinterest génère un portrait cohérent avec le format réellement livré par Studio", () => {
  const format = adsMediaFormatForPlan({ provider: "pinterest", campaignType: "generic" }, "image");
  const studio = AI_MEDIA_FORMAT_SPECS[format];
  assert.equal(format, "portrait");
  assert.equal(studio.aspectRatio, PINTEREST_ADS_IMAGE_SPEC.aspectRatio);
  assert.equal(studio.width, PINTEREST_ADS_IMAGE_SPEC.width);
  assert.equal(studio.height, PINTEREST_ADS_IMAGE_SPEC.height);
  const prompt = pinterestAdsImagePrompt({
    offer: "Aménagement de cuisines",
    name: "Inspiration cuisine",
    primaryText: "Découvrez des idées d’aménagement.",
    targetAudiences: ["propriétaires locaux"],
    mediaBrief: "Une cuisine lumineuse, avec des rangements accessibles.",
  });
  assert.match(withUiCopy(prompt), /Pinterest verticale.*4:5.*1080 × 1350/);
  assert.match(withUiCopy(prompt), /Aménagement de cuisines/);
  assert.match(withUiCopy(prompt), /rangements accessibles/);
  assert.match(withUiCopy(prompt), /jamais une réalisation client attestée/);
  assert.match(withUiCopy(prompt), /Aucun texte incrusté/);
  assert.ok(prompt.length <= 1_800);
  const olderDraftPrompt = pinterestAdsImagePrompt({ name: "Cuisine", offer: "Cuisine", targetAudiences: [], mediaBrief: "Ancien format 2:3. " + "Détail ".repeat(500) });
  assert.ok(olderDraftPrompt.length <= 1_800);
  assert.ok(olderDraftPrompt.endsWith("Le format final 4:5 et ces contraintes priment sur toute consigne contradictoire du brief."));
});

test("le format Pinterest n’altère ni les autres canaux ni les vidéos", () => {
  assert.equal(adsMediaFormatForPlan({ provider: "google", campaignType: "display" }, "image"), "square");
  assert.equal(adsMediaFormatForPlan({ provider: "meta", campaignType: "meta_traffic" }, "image"), "portrait");
  assert.equal(adsMediaFormatForPlan({ provider: "google", campaignType: "video" }, "video"), "landscape");
  assert.equal(adsMediaFormatForPlan({ provider: "pinterest", campaignType: "generic" }, "video"), "story");
});

test("ChatGPT Ads prépare un JPG carré et un brief visuel fidèle au commerce local", () => {
  assert.equal(CHATGPT_ADS_MIN_IMAGE_SIDE_PX, 640);
  assert.equal(CHATGPT_ADS_MAX_IMAGE_BYTES, 20 * 1024 * 1024);
  const format = adsMediaFormatForPlan({ provider: "openai", campaignType: "generic" }, "image");
  assert.equal(format, "square");
  assert.equal(AI_MEDIA_FORMAT_SPECS[format].width, AI_MEDIA_FORMAT_SPECS[format].height);
  const prompt = chatgptAdsImagePrompt({
    offer: "Réparation de vélos à Lille",
    primaryText: "Faites réparer votre vélo près de chez vous.",
    targetLocations: ["Lille"],
    mediaBrief: "Un atelier lumineux avec un vélo sur pied de réparation.",
  });
  assert.ok(prompt.startsWith(CHATGPT_ADS_IMAGE_REQUIREMENTS));
  assert.match(withUiCopy(prompt), /Réparation de vélos à Lille/);
  assert.match(withUiCopy(prompt), /Aucun texte incrusté/);
  assert.match(withUiCopy(prompt), /sans inventer.*approbation par ChatGPT ou OpenAI/);
  assert.ok(prompt.length <= 1_800);
});

test("l’analyse génère seulement un média compatible avec le format", () => {
  const search = { provider: "google", campaignType: "search", mediaStrategy: "search_text" } as const;
  assert.equal(shouldGenerateAdsMedia(search), false);
  assert.equal(adsMediaKindForPlan({ ...search, creativeType: "image" }), "image");
  assert.equal(adsMediaStrategyAfterAttachment(search, "image"), "search_text");
  assert.equal(shouldGenerateAdsMedia({ provider: "google", campaignType: "shopping", mediaStrategy: "product_feed" }), false);
  assert.equal(shouldGenerateAdsMedia({ provider: "x", campaignType: "generic", mediaStrategy: "search_text" }), false);
  assert.equal(shouldGenerateAdsMedia({ provider: "meta", campaignType: "meta_traffic", mediaStrategy: "image" }), true);
  assert.equal(adsMediaKindForPlan({ provider: "tiktok", campaignType: "generic", mediaStrategy: "video", creativeType: "video" }), "video");
});

test("les deux prompts Meta verrouillent les formats publicitaires Feed et Story/Reel", () => {
  const context = {
    offer: "Audit énergétique pour commerces",
    name: "Campagne économies d’énergie",
    primaryText: "Réduisez durablement les dépenses énergétiques de votre commerce.",
    callToAction: "En savoir plus",
    targetAudiences: ["commerçants locaux"],
    mediaBrief: "Montrer une boutique lumineuse et crédible",
  };
  const feedPrompt = metaFeedImagePrompt(context);
  const storyReelPrompt = metaStoryReelImagePrompt(context);
  assert.deepEqual(META_ADS_CREATIVE_SPECS.feed, {
    outputFormat: "portrait", aspectRatio: "4:5", width: 1080, height: 1350,
  });
  assert.deepEqual(META_ADS_CREATIVE_SPECS.storyReel, {
    outputFormat: "story", aspectRatio: "9:16", width: 1080, height: 1920,
  });
  assert.match(withUiCopy(feedPrompt), /Meta Feed.*4:5.*1080 × 1350/);
  assert.match(withUiCopy(storyReelPrompt), /Story\/Reel.*9:16.*1080 × 1920/);
  assert.match(withUiCopy(storyReelPrompt), /zones dégagées en haut et en bas/);
  assert.match(withUiCopy(feedPrompt), /Audit énergétique pour commerces/);
  assert.match(withUiCopy(feedPrompt), /commerçants locaux/);
  assert.match(withUiCopy(feedPrompt), /Aucun texte lisible/);
  assert.ok(feedPrompt.length <= 1_800);
  assert.ok(storyReelPrompt.length <= 1_800);
});

test("la readiness Meta exige chaque asset correspondant sans recadrage implicite", () => {
  const legacyFeed = assessMetaCreativeAssetReadiness({
    metaPlacements: ["facebook_feed", "instagram_feed"],
    imageUrl: "https://example.com/legacy-feed.jpg",
  });
  assert.equal(legacyFeed.ready, true);
  assert.equal(metaCreativeAssetReadinessReason(legacyFeed), null);

  const missingStory = assessMetaCreativeAssetReadiness({
    metaPlacements: ["facebook_feed", "stories", "reels"],
    imageUrl: "https://example.com/feed.jpg",
  });
  assert.equal(missingStory.ready, false);
  assert.deepEqual(missingStory.missingAssets, ["storyReelImageUrl"]);
  assert.match(withUiCopy(metaCreativeAssetReadinessReason(missingStory) || ""), /Story\/Reel 9:16/);

  const complete = assessMetaCreativeAssetReadiness({
    metaPlacements: ["facebook_feed", "stories", "reels"],
    metaCreativeAssets: {
      feedImageUrl: "https://example.com/feed.jpg",
      storyReelImageUrl: "https://example.com/story.jpg",
    },
  });
  assert.equal(complete.ready, true);
  assert.deepEqual(complete.missingAssets, []);

  const duplicated = assessMetaCreativeAssetReadiness({
    metaPlacements: ["instagram_feed", "stories"],
    metaCreativeAssets: {
      feedImageUrl: "https://example.com/same-image.jpg",
      storyReelImageUrl: "https://example.com/same-image.jpg",
    },
  });
  assert.equal(duplicated.ready, false);
  assert.equal(duplicated.reusesSameImageAcrossFormats, true);
  assert.match(withUiCopy(metaCreativeAssetReadinessReason(duplicated) || ""), /deux images Meta distinctes/);

  const unsupported = assessMetaCreativeAssetReadiness({
    metaPlacements: ["messenger"],
    metaCreativeAssets: { feedImageUrl: "", storyReelImageUrl: "" },
  });
  assert.equal(unsupported.ready, false);
  assert.deepEqual(unsupported.unsupportedPlacements, ["messenger"]);
  assert.match(withUiCopy(metaCreativeAssetReadinessReason(unsupported) || ""), /pas Messenger/);
});

test("Google Search crée la campagne en pause sans liaison d’image rejetée par Google", () => {
  const publisher = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(withUiCopy(publisher), /advertisingChannelType: "SEARCH"/);
  assert.match(withUiCopy(publisher), /responsiveSearchAd:/);
  assert.match(withUiCopy(publisher), /partialFailure: false/);
  assert.doesNotMatch(withUiCopy(publisher), /campaignAssetOperation|adGroupAssetOperation|fieldType: "AD_IMAGE"/);
  assert.doesNotMatch(withUiCopy(route), /prepareGoogleSearchImageAsset/);
  assert.match(withUiCopy(route), /rejectedBeforeCreate \? "draft" : "needs_review"/);
});

test("l’UI ne promet pas de média pour les formats sans média et signale l’échec", () => {
  const generator = readFileSync(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
  const client = ["../app/dashboard/ads/AdsClient.tsx", "../lib/adsCampaignPlanClient.ts"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  assert.match(withUiCopy(generator), /shouldGenerateAdsMedia/);
  assert.match(withUiCopy(generator), /aucun média n’a été généré/);
  assert.match(withUiCopy(client), /iNr’Studio n’a pas pu créer le média/);
  assert.match(withUiCopy(client), /const hasMediaStep = adsDraftHasMediaStep\(draft\)/);
  assert.match(withUiCopy(client), /\.\.\.\(hasMediaStep \? \[mediaStepName\] : \[\]\)/);
  assert.match(withUiCopy(client), /\{hasMediaStep && <section hidden=\{step !== mediaStep\}/);
  assert.match(withUiCopy(client), /mediaBrief: plan\.mediaBrief,/);
});

test("les campagnes visuelles gardent leur aperçu et Google Search n’annonce pas d’image publiée", () => {
  const client = ["../app/dashboard/ads/AdsClient.tsx", "../lib/adsCampaignPlanClient.ts"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  const css = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
  assert.match(withUiCopy(client), /const attachedCampaignMediaUrl = googleSearchMedia \? draft\.imageUrl : draft\.creativeUrl \|\| draft\.imageUrl/);
  assert.match(withUiCopy(client), /<CampaignMediaPreview key=\{/);
  assert.match(withUiCopy(client), /<Image src=\{url\}/);
  assert.match(withUiCopy(client), /fill unoptimized sizes=/);
  assert.match(withUiCopy(client), /<video src=\{url\}/);
  assert.match(withUiCopy(client), /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(withUiCopy(client), /Aperçu du média indisponible/);
  assert.match(withUiCopy(client), /googleSearchMedia \? i18nT\("annonces_textuelles_1a75ba49"\)/);
  assert.match(withUiCopy(client), /Image conservée dans iNrCy/);
  assert.match(withUiCopy(client), /Non jointe à la campagne Google Search/);
  assert.match(withUiCopy(css), /\.campaignMediaPreview\{[^}]*height:clamp\(/);
});

test("le brief Google Search garde les règles visuelles et la pertinence commerciale", () => {
  const planRoute = readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8");
  const context = {
    offer: "Conseil en communication",
    name: "Campagne conseil",
    keywords: ["agence communication", "conseil publicité"],
    targetAudiences: ["artisans"],
    mediaBrief: "Montrer une équipe au travail",
  };
  const prompt = googleSearchImagePrompt(context);
  const subject = googleSearchImageSubjectPrompt(context);
  assert.match(withUiCopy(prompt), /image publicitaire carrée 1:1/);
  assert.match(withUiCopy(prompt), /80 % centraux/);
  assert.match(withUiCopy(prompt), /Aucun texte lisible/);
  assert.match(withUiCopy(prompt), /logo ajouté/);
  assert.match(withUiCopy(prompt), /page de destination/);
  assert.match(withUiCopy(prompt), /agence communication/);
  assert.match(withUiCopy(subject), /artisans/);
  assert.ok(prompt.startsWith(GOOGLE_SEARCH_IMAGE_REQUIREMENTS));
  assert.match(withUiCopy(prompt), /contraintes priment sur toute direction visuelle contradictoire/);
  assert.ok(prompt.length <= 1_800);
  assert.match(withUiCopy(planRoute), /Pour Google Search : garde mediaStrategy="search_text" et creativeType="image"/);
  assert.match(withUiCopy(planRoute), /Ne promets pas de composant image/);
  assert.match(withUiCopy(planRoute), /Laisse mediaBrief, imageUrl et creativeUrl vides/);
});
