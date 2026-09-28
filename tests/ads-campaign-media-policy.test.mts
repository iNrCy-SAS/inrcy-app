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
  assert.equal(shouldGenerateAdsMedia(search), false);
  assert.equal(adsMediaKindForPlan({ ...search, creativeType: "image" }), "image");
  assert.equal(adsMediaStrategyAfterAttachment(search, "image"), "search_text");
  assert.equal(shouldGenerateAdsMedia({ provider: "google", campaignType: "shopping", mediaStrategy: "product_feed" }), false);
  assert.equal(shouldGenerateAdsMedia({ provider: "x", campaignType: "generic", mediaStrategy: "search_text" }), false);
  assert.equal(shouldGenerateAdsMedia({ provider: "meta", campaignType: "meta_traffic", mediaStrategy: "image" }), true);
  assert.equal(adsMediaKindForPlan({ provider: "tiktok", campaignType: "generic", mediaStrategy: "video", creativeType: "video" }), "video");
});

test("Google Search crée la campagne en pause sans liaison d’image rejetée par Google", () => {
  const publisher = readFileSync(new URL("../lib/adsGooglePublish.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(publisher, /advertisingChannelType: "SEARCH"/);
  assert.match(publisher, /responsiveSearchAd:/);
  assert.match(publisher, /partialFailure: false/);
  assert.doesNotMatch(publisher, /campaignAssetOperation|adGroupAssetOperation|fieldType: "AD_IMAGE"/);
  assert.doesNotMatch(route, /prepareGoogleSearchImageAsset/);
  assert.match(route, /rejectedBeforeCreate \? "draft" : "needs_review"/);
});

test("l’UI ne promet pas de média pour les formats sans média et signale l’échec", () => {
  const generator = readFileSync(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  assert.match(generator, /shouldGenerateAdsMedia/);
  assert.match(generator, /aucun média n’a été généré/);
  assert.match(client, /iNr’Studio n’a pas pu créer le média/);
  assert.match(client, /const hasMediaStep = !\(channelId === "google" && draft\.campaignType === "search"\)/);
  assert.match(client, /\.\.\.\(hasMediaStep \? \["Médias"\] : \[\]\)/);
  assert.match(client, /\{hasMediaStep && <section hidden=\{step !== mediaStep\}/);
  assert.match(client, /mediaBrief: plan\.mediaBrief,/);
});

test("les campagnes visuelles gardent leur aperçu et Google Search n’annonce pas d’image publiée", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
  assert.match(client, /const attachedCampaignMediaUrl = googleSearchMedia \? draft\.imageUrl : draft\.creativeUrl \|\| draft\.imageUrl/);
  assert.match(client, /<CampaignMediaPreview key=\{/);
  assert.match(client, /<Image src=\{url\}/);
  assert.match(client, /fill unoptimized sizes=/);
  assert.match(client, /<video src=\{url\}/);
  assert.match(client, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(client, /Aperçu du média indisponible/);
  assert.match(client, /googleSearchMedia \? "Annonces textuelles"/);
  assert.match(client, /Image conservée dans iNrCy, non jointe à Google/);
  assert.match(css, /\.campaignMediaPreview\{[^}]*height:clamp\(/);
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
  assert.match(planRoute, /Ne promets pas de composant image/);
  assert.match(planRoute, /Laisse mediaBrief, imageUrl et creativeUrl vides/);
});
