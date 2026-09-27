import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  adsMediaKindForPlan,
  adsMediaStrategyAfterAttachment,
  GOOGLE_SEARCH_IMAGE_REQUIREMENTS,
  googleSearchImagePrompt,
  googleSearchImageSubjectPrompt,
  shouldGenerateAdsMedia,
} from "../lib/adsCampaignMediaPolicy.ts";

test("l’analyse génère seulement un média compatible avec le format", () => {
  const search = { provider: "google", campaignType: "search", mediaStrategy: "search_text" } as const;
  assert.equal(shouldGenerateAdsMedia(search), true);
  assert.equal(adsMediaKindForPlan({ ...search, creativeType: "image" }), "image");
  assert.equal(adsMediaStrategyAfterAttachment(search, "image"), "search_text");
  assert.equal(shouldGenerateAdsMedia({ provider: "google", campaignType: "shopping", mediaStrategy: "product_feed" }), false);
  assert.equal(shouldGenerateAdsMedia({ provider: "x", campaignType: "generic", mediaStrategy: "search_text" }), false);
  assert.equal(shouldGenerateAdsMedia({ provider: "meta", campaignType: "meta_traffic", mediaStrategy: "image" }), true);
  assert.equal(adsMediaKindForPlan({ provider: "tiktok", campaignType: "generic", mediaStrategy: "video", creativeType: "video" }), "video");
});

test("Google Search joint réellement l’image, sans se limiter au texte de l’interface", () => {
  const publisher = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  const image = readFileSync(new URL("../lib/adsGoogleImageAsset.ts", import.meta.url), "utf8");
  assert.match(publisher, /assetOperation: \{ create:/);
  assert.match(publisher, /imageAsset: \{ data: imageData \}/);
  assert.match(publisher, /campaignAssetOperation: \{ create:/);
  assert.match(publisher, /fieldType: "AD_IMAGE"/);
  assert.match(publisher, /campaignImageAssetResourceName:/);
  assert.match(route, /prepareGoogleSearchImageAsset\(user\.activeUserId, draft\.imageUrl\)/);
  assert.ok(route.indexOf("prepareGoogleSearchImageAsset(user.activeUserId, draft.imageUrl)") < route.indexOf('supabaseAdmin.rpc("inrcy_claim_ads_draft_for_publish"'));
  assert.match(image, /verifyMediaLibraryContentToken/);
  assert.match(image, /\.eq\("user_id", userId\)/);
  assert.match(image, /\.storage\.from\(bucket\)\.download\(path\)/);
  assert.doesNotMatch(image, /fetch\(imageUrl/);
});

test("l’UI ne promet pas de média pour les formats sans média et signale l’échec", () => {
  const generator = readFileSync(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../app/dashboard/_components/MediaGeneratorModal.tsx", import.meta.url), "utf8");
  const freeGenerator = readFileSync(new URL("../app/dashboard/_components/MediaFreeGenerator.tsx", import.meta.url), "utf8");
  assert.match(generator, /shouldGenerateAdsMedia/);
  assert.match(generator, /aucun média n’a été généré/);
  assert.match(generator, /logoMode: googleSearchImage \? "none"/);
  assert.match(generator, /googleSearchImagePrompt\(plan\)/);
  assert.match(client, /iNr’Studio n’a pas pu créer le média/);
  assert.match(client, /La campagne assistée Google Search attend l’image complémentaire/);
  assert.match(client, /imageUrl: plan\.imageUrl,/);
  assert.match(client, /creativeUrl: plan\.creativeUrl,/);
  assert.match(client, /imageOnly=\{googleSearchMedia\}/);
  assert.match(client, /freeOnly=\{googleSearchMedia\}/);
  assert.match(client, /fixedFreeFormat=\{googleSearchMedia \? "square"/);
  assert.match(modal, /imageOnly && mediaType === "video"/);
  assert.match(freeGenerator, /freePrompt: effectivePrompt/);
  assert.match(freeGenerator, /format: fixedFormat \|\| format/);
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
  assert.match(prompt, /image publicitaire carrée 1:1/);
  assert.match(prompt, /80 % centraux/);
  assert.match(prompt, /Aucun texte lisible/);
  assert.match(prompt, /logo ajouté/);
  assert.match(prompt, /page de destination/);
  assert.match(prompt, /agence communication/);
  assert.match(subject, /artisans/);
  assert.ok(prompt.startsWith(GOOGLE_SEARCH_IMAGE_REQUIREMENTS));
  assert.match(prompt, /contraintes priment sur toute direction visuelle contradictoire/);
  assert.ok(prompt.length <= 1_800);
  assert.match(planRoute, /Pour Google Search : garde mediaStrategy="search_text" et creativeType="image"/);
  assert.match(planRoute, /l’offre réelle, aux recherches et à la page de destination/);
  assert.match(planRoute, /Laisse imageUrl et creativeUrl vides/);
});
