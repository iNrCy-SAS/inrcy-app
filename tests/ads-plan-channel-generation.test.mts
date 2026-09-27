import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isReviewableAdsCampaignPlan,
  normalizeAdsCampaignPlan,
  normalizePlannedAdsChannelDraft,
  plannedAdsChannelPlanPrompt,
} from "../lib/adsCampaignPlan.ts";
import { assessAdsChannelDraft } from "../lib/adsChannelDrafts.ts";

const trusted = {
  companyName: "Atelier Exemple",
  destinationUrl: "https://atelier.example/offre",
  locations: ["Lyon, France"],
  audiences: ["Entreprises locales"],
  services: ["Accompagnement professionnel"],
};

const common = {
  schemaVersion: 1,
  name: "Accompagnement à Lyon",
  budget: { amount: 30, currency: "EUR", period: "daily", level: "campaign" },
  audience: { locationBriefs: ["Paris"], audienceBrief: "Dirigeants cherchant un accompagnement professionnel à Lyon" },
  externalRefs: { adAccountId: "invented-by-model", pixelId: "invented-by-model" },
};

const drafts = {
  linkedin: {
    ...common,
    channel: "linkedin",
    objectiveType: "WEBSITE_VISIT",
    format: "STANDARD_UPDATE",
    locale: { country: "FR", language: "fr" },
    creative: {
      introText: "Découvrez notre accompagnement professionnel pour vos projets lyonnais.",
      headline: "Un accompagnement professionnel local et concret",
      mediaBrief: "Un portrait sobre de l’équipe, à créer et à faire valider.",
      destinationUrl: "https://invented.example/landing",
    },
  },
  tiktok: {
    ...common,
    channel: "tiktok",
    objectiveType: "TRAFFIC",
    format: "video",
    destinationKind: "website",
    placementIntent: "tiktok_only",
    optimizationIntent: "clicks",
    creative: {
      adText: "Découvrez notre accompagnement à Lyon",
      videoBrief: "Vidéo verticale montrant une démonstration du service à créer.",
      destinationUrl: "https://invented.example/landing",
    },
  },
  pinterest: {
    ...common,
    channel: "pinterest",
    objectiveType: "LEADS",
    intendedPromotionType: "STANDARD_AD",
    creativeType: "REGULAR",
    conversionEvent: "LEAD",
    creative: {
      pinTitle: "Préparez votre projet avec un expert local",
      pinDescription: "Un accompagnement clair pour avancer dans votre projet avec l’Atelier Exemple à Lyon.",
      visualBrief: "Créer une image verticale centrée sur le service et ses étapes.",
      destinationUrl: "https://invented.example/landing",
    },
  },
  x: {
    ...common,
    channel: "x",
    objective: "website_traffic",
    format: "text",
    targetingMode: "keywords",
    keywords: ["accompagnement entreprise", "projet professionnel"],
    creative: {
      postText: "Un projet professionnel à Lyon ? Découvrez comment nous pouvons vous accompagner.",
      mediaBrief: "",
      destinationUrl: "https://invented.example/landing",
    },
  },
} as const;

test("all planned channels produce reviewable, platform-specific drafts without fabricated resources", () => {
  for (const channel of ["linkedin", "tiktok", "pinterest", "x"] as const) {
    const plan = normalizeAdsCampaignPlan({
      name: "Accompagnement local",
      offer: "Accompagnement professionnel",
      campaignType: "generic",
      channelDraft: drafts[channel],
    }, { provider: channel, ...trusted });
    assert.equal(isReviewableAdsCampaignPlan(plan, channel), true, channel);
    assert.equal(plan.channelDraft?.channel, channel);
    assert.equal(plan.channelDraft?.creative.destinationUrl, trusted.destinationUrl);
    assert.deepEqual(plan.channelDraft?.audience.locationBriefs, trusted.locations);
    assert.equal("externalRefs" in (plan.channelDraft || {}), false);
    assert.equal(assessAdsChannelDraft(plan.channelDraft).publicationReady, false);
    assert.ok(plan.primaryText);
    assert.ok(plan.mediaBrief || channel === "x");
  }
});

test("native copy keeps channel lengths while Google retains 30/90", () => {
  const longHeadline = "H".repeat(120);
  const longDescription = "D".repeat(220);
  const pinterest = normalizeAdsCampaignPlan({
    name: "Pinterest",
    offer: "Accompagnement professionnel",
    headlines: [longHeadline],
    descriptions: [longDescription],
    channelDraft: drafts.pinterest,
  }, { provider: "pinterest", ...trusted });
  assert.equal(pinterest.headlines[0].length, 100);
  assert.equal(pinterest.descriptions[0].length, 220);
  const linkedin = normalizeAdsCampaignPlan({
    name: "LinkedIn",
    offer: "Accompagnement professionnel",
    headlines: [longHeadline],
    descriptions: [longDescription],
    channelDraft: drafts.linkedin,
  }, { provider: "linkedin", ...trusted });
  assert.equal(linkedin.headlines[0].length, 120);
  assert.equal(linkedin.descriptions[0].length, 220);
  const google = normalizeAdsCampaignPlan({ headlines: [longHeadline], descriptions: [longDescription] }, { provider: "google", ...trusted });
  assert.equal(google.headlines[0].length, 30);
  assert.equal(google.descriptions[0].length, 90);
  assert.equal(google.channelDraft, undefined);
});

test("missing or incompatible native fields fail closed and require the next model", () => {
  const missing = normalizeAdsCampaignPlan({ name: "X", offer: "Service", primaryText: "Texte générique" }, { provider: "x", ...trusted });
  assert.equal(isReviewableAdsCampaignPlan(missing, "x"), false);
  const mismatched = normalizePlannedAdsChannelDraft(drafts.tiktok, { provider: "linkedin", ...trusted });
  assert.equal(mismatched, null);
  const invalid = normalizePlannedAdsChannelDraft({ ...drafts.tiktok, objectiveType: "WEB_CONVERSIONS" }, { provider: "tiktok", ...trusted });
  assert.equal(invalid, null);
  const noTrustedZone = normalizePlannedAdsChannelDraft(drafts.linkedin, { provider: "linkedin", ...trusted, locations: [] });
  assert.equal(noTrustedZone, null);
});

test("native prompts demand a brief only and do not assert publication access", () => {
  for (const channel of ["linkedin", "tiktok", "pinterest", "x"] as const) {
    const prompt = plannedAdsChannelPlanPrompt(channel);
    assert.match(prompt, /BROUILLON/);
    assert.match(prompt, /aucun adaptateur de publication/);
    assert.match(prompt, /N’ajoute PAS externalRefs/);
    assert.match(prompt, /channelDraft/);
    assert.match(prompt, /pas les limites Google de 30\/90/);
  }
});
