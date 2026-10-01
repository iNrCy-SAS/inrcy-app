import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adsIncompleteLaunchMessage,
  adsIncompleteLaunchSteps,
  type AdsLaunchStepMap,
} from "../lib/adsLaunchReadiness.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";

const steps: AdsLaunchStepMap = {
  foundations: 3,
  targeting: 4,
  keywords: 5,
  creative: 6,
  media: 7,
  delivery: 8,
  budget: 9,
  validation: 10,
};

function campaign(provider: AdsCampaignInput["provider"]): AdsCampaignInput {
  return {
    provider,
    creationMode: "inrcy",
    campaignType: provider === "google" ? "search" : provider === "meta" ? "meta_traffic" : "generic",
    objective: provider === "meta" ? "website_traffic" : "leads",
    conversionGoal: provider === "meta" ? "website_visit" : "quote_request",
    conversionLocation: "website",
    bidStrategy: "maximize_clicks",
    adAccountId: "123456789",
    accountCurrency: "EUR",
    name: "Campagne de test",
    offer: "Une offre claire",
    dailyBudgetEuros: 30,
    pinterestBidEuros: 1,
    endDate: "2026-10-20",
    destinationUrl: "https://example.com",
    urlExpansion: false,
    urlExclusions: [],
    targetLocations: ["France"],
    targetAudiences: ["Professionnels"],
    languages: ["fr"],
    googleSearchPartners: false,
    googleDisplayExpansion: false,
    metaAudienceExpansion: true,
    metaPlacements: ["facebook_feed"],
    trackingParameters: "",
    primaryText: "Un message publicitaire suffisamment précis.",
    imageUrl: "https://example.com/image.jpg",
    metaCreativeAssets: { feedImageUrl: "https://example.com/image.jpg", storyReelImageUrl: "" },
    creativeUrl: "https://example.com/image.jpg",
    creativeType: "image",
    mediaStrategy: provider === "google" ? "search_text" : "image",
    mediaBrief: "Visuel publicitaire",
    callToAction: "En savoir plus",
    pageId: "987654321",
    headlines: ["Titre un", "Titre deux", "Titre trois"],
    descriptions: ["Description un", "Description deux"],
    keywords: ["mot clé"],
    negativeKeywords: [],
    noSpecialCategoryConfirmed: true,
    notEuPoliticalConfirmed: true,
  };
}

test("LinkedIn signale chaque étape réellement incomplète sans empêcher un brouillon", () => {
  const draft = campaign("linkedin");
  draft.linkedinCampaignGroupId = "";
  draft.linkedinOrganizationUrn = "";
  draft.linkedinGeoTargets = [];
  draft.linkedinBidEuros = undefined;
  draft.linkedinPoliticalIntentConfirmed = false;
  draft.linkedinTargetingNoticeAcknowledged = false;

  assert.deepEqual(adsIncompleteLaunchSteps({
    draft,
    steps,
    accountReady: true,
    destinationReady: true,
    mediaReady: false,
    now: Date.parse("2026-10-01T12:00:00Z"),
  }), [3, 4, 7, 9, 10]);
});

test("LinkedIn exige une zone exacte fournie par son API, pas seulement un libellé du brief", () => {
  const draft = campaign("linkedin");
  draft.linkedinCampaignGroupId = "456";
  draft.linkedinOrganizationUrn = "urn:li:organization:789";
  draft.linkedinBidEuros = 2.5;
  draft.linkedinPoliticalIntentConfirmed = true;
  draft.linkedinTargetingNoticeAcknowledged = true;
  draft.linkedinGeoTargets = [{ urn: "", name: "Arras" }];

  const readiness = (linkedinGeoTargets: AdsCampaignInput["linkedinGeoTargets"]) => {
    draft.linkedinGeoTargets = linkedinGeoTargets;
    return adsIncompleteLaunchSteps({
      draft,
      steps,
      accountReady: true,
      destinationReady: true,
      mediaReady: true,
      now: Date.parse("2026-10-01T12:00:00Z"),
    });
  };

  assert.deepEqual(readiness([{ urn: "", name: "Arras" }]), [4]);
  assert.deepEqual(readiness([{ urn: "urn:li:geo:123456", name: "Arras, Hauts-de-France, France" }]), []);
});

test("Meta rattache les champs manquants à leurs étapes du studio", () => {
  const draft = campaign("meta");
  draft.targetLocations = [];
  draft.primaryText = "";
  draft.callToAction = "";
  draft.metaPlacements = [];
  draft.noSpecialCategoryConfirmed = false;

  assert.deepEqual(adsIncompleteLaunchSteps({
    draft,
    steps,
    accountReady: true,
    destinationReady: true,
    mediaReady: false,
    now: Date.parse("2026-10-01T12:00:00Z"),
  }), [4, 6, 7, 8, 10]);
});

test("ChatGPT Ads rattache destination, créatif, média et enchère aux bonnes étapes", () => {
  const draft = campaign("openai");
  draft.objective = "website_traffic";
  draft.conversionGoal = "website_visit";
  draft.bidStrategy = "manual_review";
  draft.targetLocations = [];
  draft.headlines = [];
  draft.primaryText = "";
  draft.descriptions = [];
  draft.dailyBudgetEuros = 10;
  draft.openaiBidEuros = 12;

  assert.deepEqual(adsIncompleteLaunchSteps({
    draft,
    steps,
    accountReady: true,
    destinationReady: false,
    mediaReady: false,
    now: Date.parse("2026-10-01T12:00:00Z"),
  }), [4, 6, 7, 8, 9]);

  draft.targetLocations = ["Lille"];
  draft.headlines = ["Diagnostic local"];
  draft.primaryText = "Découvrez notre diagnostic local.";
  draft.descriptions = [draft.primaryText];
  draft.dailyBudgetEuros = 15;
  draft.openaiBidEuros = 1.5;
  assert.deepEqual(adsIncompleteLaunchSteps({
    draft,
    steps,
    accountReady: true,
    destinationReady: true,
    mediaReady: true,
    now: Date.parse("2026-10-01T12:00:00Z"),
  }), []);
});

test("le message de survol donne les numéros des étapes", () => {
  assert.equal(
    adsIncompleteLaunchMessage([3, 4, 9]),
    "Informations manquantes : complétez les étapes 3, 4 et 9 avant de lancer la campagne.",
  );
  assert.equal(
    adsIncompleteLaunchMessage([7]),
    "Informations manquantes : complétez l’étape 7 avant de lancer la campagne.",
  );
  assert.equal(
    adsIncompleteLaunchMessage([4], "linkedin", 4),
    "Informations manquantes : complétez l’étape 4 avant de lancer la campagne. Sélectionnez au moins une zone exacte vérifiée par LinkedIn ; le libellé affiché dans le brief ne suffit pas.",
  );
  assert.equal(
    adsIncompleteLaunchMessage([4], "meta", 4),
    "Informations manquantes : complétez l’étape 4 avant de lancer la campagne.",
  );
  assert.equal(
    adsIncompleteLaunchMessage([3], "linkedin", 3),
    "Informations manquantes : complétez l’étape 3 avant de lancer la campagne. Sélectionnez au moins une zone exacte vérifiée par LinkedIn ; le libellé affiché dans le brief ne suffit pas.",
  );
});

test("le studio garde la navigation et le brouillon disponibles, puis avertit seulement au lancement", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

  assert.doesNotMatch(client, /if \(dx < 0 && current === deliveryStep && !destinationReview\.canContinue\) return current/);
  assert.doesNotMatch(client, /disabled=\{busy === "plan"[^}]*destinationReview\.canContinue/);
  assert.match(client, /studioFinalActionButtons[\s\S]*?Enregistrer en brouillon[\s\S]*?studioLaunchGuard/);
  assert.match(client, /adsIncompleteLaunchMessage\([\s\S]*?incompleteLaunchSteps,[\s\S]*?draft\.provider,[\s\S]*?targetingStep \+ 1/);
  assert.match(client, /disabled=\{busy !== null \|\| launchBlocked\}/);
  assert.match(client, /studioLaunchWarning[\s\S]*?⚠/);
  assert.match(css, /\.studioLaunchWarning\{[^}]*#ffd760/);
});
