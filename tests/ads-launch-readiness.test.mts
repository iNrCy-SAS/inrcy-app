import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  adsIncompleteLaunchMessage,
  adsIncompleteLaunchSteps,
  type AdsLaunchStepMap,
} from "../lib/adsLaunchReadiness.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import { defaultLinkedInDeliverySettings } from "../lib/adsLinkedInCampaignSettings.ts";
import { defaultGoogleDeliverySettings } from "../lib/adsGoogleCampaignSettings.ts";
import { defaultPinterestDeliverySettings } from "../lib/adsPinterestCampaignSettings.ts";
import { defaultMetaDeliverySettings, type MetaCallToAction } from "../lib/adsMetaCampaignSettings.ts";
import { defaultOpenaiDeliverySettings, type OpenaiAdsPlatform } from "../lib/adsOpenaiCampaignSettings.ts";

const metaAssistedSteps: AdsLaunchStepMap = { foundations: 3, geography: 4, targeting: 5, bidding: 6, keywords: 0, creative: 7, media: 8, delivery: 9, budget: 10, destinationConfirmation: 11, validation: 11 };
const openaiAssistedSteps: AdsLaunchStepMap = { foundations: 3, budget: 4, geography: 5, targeting: 6, bidding: 7, keywords: 0, creative: 8, media: 9, delivery: 10, destinationConfirmation: 11, validation: 11 };
function nativeCampaign(provider: "meta" | "openai") {
  const settings = provider === "meta" ? defaultMetaDeliverySettings() : defaultOpenaiDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" };
  return { ...campaign(provider), objective: "website_traffic" as const, conversionGoal: "website_visit" as const, headlines: ["Découvrez iNrCy"], descriptions: [], keywords: [], targetLocations: ["Hauts-de-France"],
    ...(provider === "meta" ? { metaDeliverySettings: settings as ReturnType<typeof defaultMetaDeliverySettings>, metaGeoTargets: [{ key: "native-hdf", type: "region" as const, name: "Hauts-de-France", countryCode: "FR" }] } : { openaiDeliverySettings: settings as ReturnType<typeof defaultOpenaiDeliverySettings>, openaiBidEuros: 1.5, bidStrategy: "manual_review" as const, callToAction: "" }),
  };
}
function nativeAssessment(draft: AdsCampaignInput, options: { destinationReady?: boolean; mediaReady?: boolean } = {}) {
  return adsIncompleteLaunchSteps({ draft, steps: draft.provider === "meta" ? metaAssistedSteps : openaiAssistedSteps, accountReady: true, destinationReady: options.destinationReady !== false, mediaReady: options.mediaReady !== false, now: Date.parse("2026-10-01T12:00:00Z"), openaiTimeZone: "Europe/Paris" });
}

test("Meta native readiness directs each missing setting to its actual separate wizard step", () => {
  const draft = nativeCampaign("meta");
  assert.deepEqual(nativeAssessment(draft), []);
  assert.deepEqual(nativeAssessment({ ...draft, targetLocations: [] }), [metaAssistedSteps.geography]);
  assert.deepEqual(nativeAssessment({ ...draft, metaGeoTargets: [] }), [metaAssistedSteps.geography]);
  assert.deepEqual(nativeAssessment(draft, { destinationReady: false }), [metaAssistedSteps.validation]);
  assert.deepEqual(nativeAssessment({ ...draft, noSpecialCategoryConfirmed: false }), [metaAssistedSteps.validation]);
  assert.deepEqual(nativeAssessment(draft, { mediaReady: false }), [metaAssistedSteps.media]);
  assert.deepEqual(nativeAssessment({ ...draft, headlines: ["Deux", "Titres"] }), [metaAssistedSteps.creative]);
  const settings = draft.metaDeliverySettings!;
  for (const audience of [{ ageMin: 17, ageMax: null }, { ageMin: 25, ageMax: 20 }]) assert.deepEqual(nativeAssessment({ ...draft, metaDeliverySettings: { ...settings, audience } }), [metaAssistedSteps.targeting]);
  assert.deepEqual(nativeAssessment({ ...draft, metaDeliverySettings: { ...settings, callToAction: "INVENTED" as MetaCallToAction } }), [metaAssistedSteps.creative]);
  assert.deepEqual(nativeAssessment({ ...draft, metaDeliverySettings: { ...settings, bidding: { strategy: "bid_cap", amountEuros: 0 } } }), [metaAssistedSteps.bidding]);
  assert.deepEqual(nativeAssessment({ ...draft, metaDeliverySettings: { ...settings, budget: { ...settings.budget, endAt: "2026-10-08T07:00:00.000Z" } } }), [metaAssistedSteps.budget]);
});

test("Meta total budget is not multiplied or replaced by the compatibility daily field", () => {
  const draft = nativeCampaign("meta"), settings = draft.metaDeliverySettings!;
  assert.deepEqual(nativeAssessment({ ...draft, dailyBudgetEuros: 25, metaDeliverySettings: { ...settings, bidding: { strategy: "bid_cap", amountEuros: 50 } } }), []);
  assert.deepEqual(nativeAssessment({ ...draft, metaDeliverySettings: { ...settings, budget: { ...settings.budget, totalEuros: 0 } } }), [metaAssistedSteps.budget]);
});

test("ChatGPT native readiness has geographic, bidding, delivery and media steps without legal or keywords gates", () => {
  const draft = nativeCampaign("openai"), settings = draft.openaiDeliverySettings!;
  assert.deepEqual(nativeAssessment(draft), []);
  assert.deepEqual(nativeAssessment({ ...draft, noSpecialCategoryConfirmed: false, notEuPoliticalConfirmed: false, keywords: [] }), []);
  assert.deepEqual(nativeAssessment({ ...draft, targetLocations: [] }), [openaiAssistedSteps.geography]);
  assert.deepEqual(nativeAssessment(draft, { destinationReady: false }), [openaiAssistedSteps.validation]);
  assert.deepEqual(nativeAssessment(draft, { mediaReady: false }), [openaiAssistedSteps.media]);
  assert.deepEqual(nativeAssessment({ ...draft, headlines: ["Deux", "Titres"] }), [openaiAssistedSteps.creative]);
  assert.deepEqual(nativeAssessment({ ...draft, openaiBidEuros: 0 }), [openaiAssistedSteps.bidding]);
  assert.deepEqual(nativeAssessment({ ...draft, openaiDeliverySettings: { ...settings, platforms: ["invented" as OpenaiAdsPlatform] } }), [openaiAssistedSteps.delivery]);
  assert.deepEqual(nativeAssessment({ ...draft, openaiDeliverySettings: { ...settings, budget: { ...settings.budget, endAt: "2026-10-08T07:00:00.000Z" } } }), [openaiAssistedSteps.budget]);
});

test("ChatGPT total budget and CPC are validated against the envelope, while daily keeps its own minimum", () => {
  const draft = nativeCampaign("openai"), settings = draft.openaiDeliverySettings!;
  assert.deepEqual(nativeAssessment({ ...draft, dailyBudgetEuros: 25, openaiBidEuros: 50 }), []);
  assert.deepEqual(nativeAssessment({ ...draft, openaiBidEuros: 201 }), [openaiAssistedSteps.bidding]);
  assert.deepEqual(nativeAssessment({ ...draft, dailyBudgetEuros: 10, openaiDeliverySettings: { ...settings, budget: { ...settings.budget, type: "daily", totalEuros: null } } }), [openaiAssistedSteps.budget]);
});

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

const linkedInSteps: AdsLaunchStepMap = {
  foundations: 3, geography: 4, targeting: 5, keywords: 6,
  creative: 7, media: 8, delivery: 9, budget: 10, validation: 11,
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

function completeLinkedInCampaign(): AdsCampaignInput {
  return {
    ...campaign("linkedin"),
    linkedinCampaignGroupId: "456", linkedinOrganizationUrn: "urn:li:organization:789",
    linkedinBidEuros: 2.5, linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true,
    linkedinGeoTargets: [{ urn: "urn:li:geo:123456", name: "Arras, Hauts-de-France, France" }],
    channelSettings: { schemaVersion: 1, channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", targetingFacet: "titles", locale: { country: "FR", language: "fr" } },
    linkedinDeliverySettings: { ...defaultLinkedInDeliverySettings(), bidding: { strategy: "maximum_delivery", amountEuros: null } },
  };
}

test("la confirmation du lien LinkedIn appartient au récapitulatif en mode IA et manuel", () => {
  const draft = completeLinkedInCampaign();
  const assess = (mapping: AdsLaunchStepMap, destinationReady: boolean) => adsIncompleteLaunchSteps({
    draft, steps: mapping, accountReady: true, destinationReady, mediaReady: true,
    now: Date.parse("2026-10-01T12:00:00Z"),
  });
  assert.deepEqual(assess(linkedInSteps, false), [linkedInSteps.delivery]);
  assert.deepEqual(assess({ ...linkedInSteps, destinationConfirmation: linkedInSteps.validation }, false), [linkedInSteps.validation]);
  assert.deepEqual(assess({ ...linkedInSteps, destinationConfirmation: linkedInSteps.validation }, true), []);
  assert.deepEqual(assess(steps, false), [steps.delivery]);

  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("AdsClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let confirmation: ts.PropertyAssignment | undefined;
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "destinationConfirmation") confirmation = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(confirmation);
  const evaluate = new Function("channelId", "creationPath", "destinationReview", "validationStep", `return (${confirmation.initializer.getText(source)});`);
  assert.equal(evaluate("linkedin", "inrcy", { valid: true }, 10), 11);
  assert.equal(evaluate("linkedin", "inrcy", { valid: false }, 10), undefined);
  assert.equal(evaluate("linkedin", "manual", { valid: true }, 9), 10);
  assert.equal(evaluate("google", "inrcy", { valid: true }, 10), 11);
  assert.equal(evaluate("google", "manual", { valid: true }, 9), 10);
  assert.equal(evaluate("google", "inrcy", { valid: false }, 10), undefined);
  assert.equal(evaluate("pinterest", "inrcy", { valid: true }, 11), 12);
  assert.equal(evaluate("pinterest", "manual", { valid: true }, 10), 11);
  assert.equal(evaluate("pinterest", "inrcy", { valid: false }, 11), undefined);
  assert.equal(evaluate("meta", "inrcy", { valid: true }, 10), 11);
  assert.equal(evaluate("meta", "manual", { valid: true }, 9), 10);
  assert.equal(evaluate("meta", "inrcy", { valid: false }, 10), undefined);
  assert.equal(evaluate("openai", "inrcy", { valid: true }, 10), 11);
  assert.equal(evaluate("openai", "manual", { valid: true }, 9), 10);
  assert.equal(evaluate("openai", "inrcy", { valid: false }, 10), undefined);
});

test("LinkedIn rattache une géographie absente ou invalide à Géographie, avec repli pour les anciens mappings", () => {
  const draft = completeLinkedInCampaign();
  const readiness = (mappedSteps: AdsLaunchStepMap) => adsIncompleteLaunchSteps({ draft, steps: mappedSteps, accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  for (const targets of [[], [{ urn: "", name: "Arras" }], [{ urn: "urn:li:geo:invalid", name: "Arras" }]]) {
    draft.linkedinGeoTargets = targets;
    assert.deepEqual(readiness(linkedInSteps), [linkedInSteps.geography]);
    assert.deepEqual(readiness(steps), [steps.targeting]);
  }
  draft.linkedinGeoTargets = [{ urn: "urn:li:geo:123456", name: "Arras" }];
  assert.deepEqual(readiness(linkedInSteps), []);
});

test("LinkedIn rattache les critères professionnels et la langue invalides à Audience, sans faux avertissement géographique", () => {
  const draft = completeLinkedInCampaign();
  const readiness = () => adsIncompleteLaunchSteps({ draft, steps: linkedInSteps, accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  assert.deepEqual(readiness(), []);
  assert.ok(draft.linkedinDeliverySettings);
  draft.linkedinDeliverySettings.professionalTargeting.include = [{ facet: "skills", urn: "urn:li:skill:invalid", name: "Gestion" }];
  assert.deepEqual(readiness(), [linkedInSteps.targeting]);
  draft.linkedinDeliverySettings.professionalTargeting.include = [];
  assert.ok(draft.channelSettings?.channel === "linkedin");
  draft.channelSettings.locale.country = "France";
  assert.deepEqual(readiness(), [linkedInSteps.targeting]);
  draft.channelSettings.locale.country = "FR";
  draft.channelSettings.locale.language = "français";
  assert.deepEqual(readiness(), [linkedInSteps.targeting]);
  draft.channelSettings.locale.language = "fr";
  assert.deepEqual(readiness(), []);
  assert.doesNotMatch(adsIncompleteLaunchMessage([linkedInSteps.targeting], "linkedin", linkedInSteps.geography), /zone exacte|libellé affiché/);
});

test("LinkedIn peut signaler simultanément les deux étapes sans les confondre", () => {
  const draft = completeLinkedInCampaign();
  draft.linkedinGeoTargets = [];
  assert.ok(draft.linkedinDeliverySettings);
  draft.linkedinDeliverySettings.professionalTargeting.include = [{ facet: "titles", urn: "urn:li:title:invalid", name: "Dirigeant" }];
  assert.deepEqual(adsIncompleteLaunchSteps({ draft, steps: linkedInSteps, accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") }), [linkedInSteps.geography, linkedInSteps.targeting]);
});

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

const pinterestAssistedSteps: AdsLaunchStepMap = {
  foundations: 3, budget: 4, geography: 5, targeting: 6, bidding: 7, keywords: -1,
  creative: 9, media: 10, delivery: 11, destinationConfirmation: 12, validation: 12,
};
const pinterestManualSteps: AdsLaunchStepMap = {
  foundations: 2, budget: 3, geography: 4, targeting: 5, bidding: 6, keywords: -1,
  creative: 8, media: 9, delivery: 10, destinationConfirmation: 11, validation: 11,
};
function completePinterestCampaign(): AdsCampaignInput {
  const delivery = defaultPinterestDeliverySettings();
  delivery.bidding = { strategy: "automatic", amountEuros: null };
  return {
    ...campaign("pinterest"), objective: "website_traffic", conversionGoal: "website_visit",
    headlines: ["Votre activité, plus simplement"], descriptions: [], keywords: [], negativeKeywords: [],
    channelSettings: { schemaVersion: 1, channel: "pinterest", objectiveType: "CONSIDERATION",
      intendedPromotionType: "STANDARD_AD", creativeType: "REGULAR", targetingMode: "automatic", conversionEvent: null },
    pinterestDeliverySettings: delivery,
  };
}
test("Pinterest rattache la géographie séparée, le média et le lien final à leurs étapes natives", () => {
  const draft = completePinterestCampaign();
  const assess = (mapping: AdsLaunchStepMap, destinationReady = true, mediaReady = true) => adsIncompleteLaunchSteps({
    draft, steps: mapping, accountReady: true, destinationReady, mediaReady, now: Date.parse("2026-10-01T12:00:00Z"),
  });
  assert.deepEqual(assess(pinterestAssistedSteps), []);
  assert.deepEqual(assess(pinterestManualSteps), []);
  assert.deepEqual(assess(pinterestAssistedSteps, false), [pinterestAssistedSteps.validation]);
  assert.deepEqual(assess(pinterestManualSteps, false), [pinterestManualSteps.validation]);
  assert.deepEqual(assess(steps, false), [steps.delivery], "Le mapping historique conserve son repli destination");
  assert.deepEqual(assess(pinterestAssistedSteps, true, false), [pinterestAssistedSteps.media]);
  draft.targetLocations = [];
  assert.deepEqual(assess(pinterestAssistedSteps), [pinterestAssistedSteps.geography]);
  assert.deepEqual(assess(pinterestManualSteps), [pinterestManualSteps.geography]);
  assert.deepEqual(assess(steps), [steps.targeting]);
  assert.doesNotMatch(adsIncompleteLaunchMessage([pinterestAssistedSteps.geography!], "pinterest", pinterestAssistedSteps.geography), /LinkedIn|URN/);
});
test("Pinterest distingue une enchère invalide du budget CBO et du calendrier", () => {
  const draft = completePinterestCampaign();
  assert.ok(draft.pinterestDeliverySettings);
  const assess = () => adsIncompleteLaunchSteps({ draft, steps: pinterestAssistedSteps,
    accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  draft.pinterestDeliverySettings.bidding = { strategy: "max_bid", amountEuros: -1 };
  assert.deepEqual(assess(), [pinterestAssistedSteps.bidding]);
  draft.pinterestDeliverySettings.bidding = { strategy: "automatic", amountEuros: null };
  draft.pinterestDeliverySettings.budget = { type: "total", totalEuros: -200, flexibleDaily: false,
    startAt: "2026-10-09T07:00:00Z", endAt: "2026-10-20T21:59:00Z" };
  assert.deepEqual(assess(), [pinterestAssistedSteps.budget]);
  draft.pinterestDeliverySettings.budget.totalEuros = 200;
  assert.deepEqual(assess(), []);
  draft.pinterestDeliverySettings.budget.startAt = "2026-10-21T07:00:00Z";
  assert.deepEqual(assess(), [pinterestAssistedSteps.budget]);
});
test("Pinterest signale un placement invalide à Audience et une annonce incomplète à Épingle", () => {
  const draft = completePinterestCampaign();
  assert.ok(draft.pinterestDeliverySettings);
  const assess = () => adsIncompleteLaunchSteps({ draft, steps: pinterestAssistedSteps,
    accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  draft.pinterestDeliverySettings.placementGroup = "UNKNOWN" as typeof draft.pinterestDeliverySettings.placementGroup;
  assert.deepEqual(assess(), [pinterestAssistedSteps.targeting]);
  draft.pinterestDeliverySettings.placementGroup = "ALL";
  draft.headlines = [""];
  draft.primaryText = "";
  assert.deepEqual(assess(), [pinterestAssistedSteps.creative]);
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
  assert.equal(
    adsIncompleteLaunchMessage([5], "linkedin", 4),
    "Informations manquantes : complétez l’étape 5 avant de lancer la campagne.",
  );
  assert.equal(
    adsIncompleteLaunchMessage([4, 5], "linkedin", 4),
    "Informations manquantes : complétez les étapes 4 et 5 avant de lancer la campagne. Sélectionnez au moins une zone exacte vérifiée par LinkedIn ; le libellé affiché dans le brief ne suffit pas.",
  );
});

test("le studio garde la navigation et le brouillon disponibles, puis avertit seulement au lancement", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

  assert.doesNotMatch(client, /if \(dx < 0 && current === deliveryStep && !destinationReview\.canContinue\) return current/);
  assert.doesNotMatch(client, /disabled=\{busy === "plan"[^}]*destinationReview\.canContinue/);
  assert.match(client, /studioFinalActionButtons[\s\S]*?Enregistrer en brouillon[\s\S]*?studioLaunchGuard/);
  assert.match(client, /adsIncompleteLaunchMessage\([\s\S]*?incompleteLaunchSteps,[\s\S]*?draft\.provider,[\s\S]*?geographyStep >= 0 \? geographyStep \+ 1 : targetingStep \+ 1/);
  const source = ts.createSourceFile("AdsClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let disabled: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "button") {
      const onClick = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "onClick");
      if (onClick?.getText(source).includes("openLaunchDialog(")) {
        const attribute = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "disabled") as ts.JsxAttribute | undefined;
        if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) disabled = attribute.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(disabled, "the actual launch button must have a gate");
  const evaluate = new Function("busy", "launchBlocked", "channelId", "creationPath", "confirmedSpend", `return (${disabled.getText(source)});`);
  for (const busy of [null, "demo"] as const) {
    for (const blocked of [false, true]) {
      for (const consent of [false, true]) {
        assert.equal(evaluate(busy, blocked, "linkedin", "inrcy", consent), busy !== null || blocked || !consent);
        assert.equal(evaluate(busy, blocked, "linkedin", "manual", consent), busy !== null || blocked);
        assert.equal(evaluate(busy, blocked, "google", "inrcy", consent), busy !== null || blocked || !consent);
        assert.equal(evaluate(busy, blocked, "google", "manual", consent), busy !== null || blocked);
        assert.equal(evaluate(busy, blocked, "pinterest", "inrcy", consent), busy !== null || blocked || !consent);
        assert.equal(evaluate(busy, blocked, "pinterest", "manual", consent), busy !== null || blocked);
        assert.equal(evaluate(busy, blocked, "meta", "inrcy", consent), busy !== null || blocked || !consent);
        assert.equal(evaluate(busy, blocked, "meta", "manual", consent), busy !== null || blocked);
        assert.equal(evaluate(busy, blocked, "openai", "inrcy", consent), busy !== null || blocked || !consent);
        assert.equal(evaluate(busy, blocked, "openai", "manual", consent), busy !== null || blocked);
      }
    }
  }
  assert.match(client, /studioLaunchWarning[\s\S]*?⚠/);
  assert.match(css, /\.studioLaunchWarning\{[^}]*#ffd760/);
});

test("LinkedIn conserve le défaut historique sans réglages natifs et bloque un choix explicite incompatible", () => {
  const draft = campaign("linkedin");
  draft.linkedinCampaignGroupId = "456";
  draft.linkedinOrganizationUrn = "urn:li:organization:789";
  draft.linkedinBidEuros = 2.5;
  draft.linkedinPoliticalIntentConfirmed = true;
  draft.linkedinTargetingNoticeAcknowledged = true;
  draft.linkedinGeoTargets = [{ urn: "urn:li:geo:123456", name: "Arras" }];
  const readiness = () => adsIncompleteLaunchSteps({ draft, steps, accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  assert.equal(draft.channelSettings, undefined);
  assert.deepEqual(readiness(), []);
  draft.channelSettings = { schemaVersion: 1, channel: "linkedin", objectiveType: "BRAND_AWARENESS", format: "STANDARD_UPDATE", targetingFacet: "skills", locale: { language: "fr", country: "FR" } };
  assert.deepEqual(readiness(), [steps.foundations]);
  draft.channelSettings.objectiveType = "WEBSITE_VISIT";
  assert.deepEqual(readiness(), []);
});

const googleAssistedSteps: AdsLaunchStepMap = {
  foundations: 3, bidding: 4, geography: 5, targeting: 6, keywords: 7,
  creative: 8, media: null, delivery: 9, destinationConfirmation: 11, budget: 10, validation: 11,
};
const googleManualSteps: AdsLaunchStepMap = {
  foundations: 2, bidding: 3, geography: 4, targeting: 5, keywords: 6,
  creative: 7, media: null, delivery: 8, destinationConfirmation: 10, budget: 9, validation: 10,
};

function completeGoogleCampaign(): AdsCampaignInput {
  return { ...campaign("google"), googleDeliverySettings: defaultGoogleDeliverySettings() };
}

test("Google sépare une géographie manquante des paramètres et garde le repli legacy", () => {
  const draft = completeGoogleCampaign();
  const assess = (mapping: AdsLaunchStepMap) => adsIncompleteLaunchSteps({ draft, steps: mapping,
    accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  assert.deepEqual(assess(googleAssistedSteps), []);
  draft.targetLocations = [];
  assert.deepEqual(assess(googleAssistedSteps), [googleAssistedSteps.geography]);
  assert.deepEqual(assess(googleManualSteps), [googleManualSteps.geography]);
  assert.deepEqual(assess(steps), [steps.targeting]);
  assert.doesNotMatch(adsIncompleteLaunchMessage([googleAssistedSteps.geography!], "google", googleAssistedSteps.geography), /LinkedIn|URN/);
});

test("Google rattache l’enchère manuelle incomplète à Enchères, sans déplacer le budget", () => {
  const draft = completeGoogleCampaign();
  draft.bidStrategy = "manual_review";
  const assess = (mapping: AdsLaunchStepMap) => adsIncompleteLaunchSteps({ draft, steps: mapping,
    accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  assert.deepEqual(assess(googleAssistedSteps), [googleAssistedSteps.bidding]);
  assert.deepEqual(assess(googleManualSteps), [googleManualSteps.bidding]);
  assert.ok(draft.googleDeliverySettings);
  draft.googleDeliverySettings.bidding.manualCpcEuros = 1.25;
  assert.deepEqual(assess(googleAssistedSteps), []);
});

test("Google peut signaler géographie, mots-clés et annonce aux étapes exactes simultanément", () => {
  const draft = completeGoogleCampaign();
  draft.targetLocations = [];
  draft.keywords = [];
  draft.headlines = ["Titre seul"];
  draft.descriptions = [];
  assert.deepEqual(adsIncompleteLaunchSteps({ draft, steps: googleAssistedSteps,
    accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") }), [5, 7, 8]);
});

test("Google confirme le lien au récapitulatif et conserve la destination legacy", () => {
  const draft = completeGoogleCampaign();
  const assess = (mapping: AdsLaunchStepMap, destinationReady: boolean) => adsIncompleteLaunchSteps({
    draft, steps: mapping, accountReady: true, destinationReady, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z"),
  });
  assert.deepEqual(assess(googleAssistedSteps, false), [11]);
  assert.deepEqual(assess(googleManualSteps, false), [10]);
  assert.deepEqual(assess(steps, false), [steps.delivery]);
  assert.deepEqual(assess(googleAssistedSteps, true), []);
});

test("Google rattache une durée totale inférieure à trois jours au budget et calendrier", () => {
  const draft = completeGoogleCampaign();
  assert.ok(draft.googleDeliverySettings);
  draft.googleDeliverySettings.budget = { type: "total", totalEuros: 200 };
  draft.googleDeliverySettings.startDate = "2026-10-19";
  const assess = () => adsIncompleteLaunchSteps({ draft, steps: googleAssistedSteps,
    accountReady: true, destinationReady: true, mediaReady: true, now: Date.parse("2026-10-01T12:00:00Z") });
  assert.deepEqual(assess(), [googleAssistedSteps.budget]);
  draft.googleDeliverySettings.startDate = "2026-10-18";
  assert.deepEqual(assess(), []);
  draft.googleDeliverySettings.startDate = "2026-10-21";
  assert.deepEqual(assess(), [googleAssistedSteps.budget]);
});

test("Google quotidien permet une campagne sur le jour courant et refuse une fin passée dans le fuseau du compte", () => {
  const draft = completeGoogleCampaign();
  draft.endDate = "2026-10-01";
  const assess = (googleTimeZone: string, now = "2026-10-01T12:00:00Z") => adsIncompleteLaunchSteps({
    draft, steps: googleAssistedSteps, accountReady: true, destinationReady: true, mediaReady: true,
    googleTimeZone, now: Date.parse(now),
  });
  assert.deepEqual(assess("Europe/Paris"), []);
  assert.deepEqual(assess("Europe/Paris", "2026-10-01T23:30:00Z"), [googleAssistedSteps.budget]);
  assert.deepEqual(assess("Pacific/Honolulu", "2026-10-01T23:30:00Z"), []);
});

test("Google quotidien contrôle aussi une date de début explicite future", () => {
  const draft = completeGoogleCampaign();
  assert.ok(draft.googleDeliverySettings);
  const assess = () => adsIncompleteLaunchSteps({ draft, steps: googleAssistedSteps,
    accountReady: true, destinationReady: true, mediaReady: true,
    googleTimeZone: "Europe/Paris", now: Date.parse("2026-10-01T12:00:00Z") });
  draft.googleDeliverySettings.startDate = "2026-10-05";
  draft.endDate = "2026-10-05";
  assert.deepEqual(assess(), []);
  draft.endDate = "2026-10-04";
  assert.deepEqual(assess(), [googleAssistedSteps.budget]);
});
