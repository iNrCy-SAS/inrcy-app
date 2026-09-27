import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADS_PLANNED_CHANNELS,
  getPlannedAdsChannelCapability,
  isPlannedAdsChannel,
} from "../lib/adsChannelCapabilities.ts";
import {
  assessAdsChannelDraft,
  type LinkedInAdsDraft,
  type PinterestAdsDraft,
  type TikTokAdsDraft,
  type XAdsDraft,
} from "../lib/adsChannelDrafts.ts";

const budget = { amount: 35, currency: "EUR", period: "daily", level: "campaign" } as const;
const audience = { locationBriefs: ["Lyon, France"], audienceBrief: "Dirigeants de PME locales" };

const linkedIn: LinkedInAdsDraft = {
  schemaVersion: 1,
  channel: "linkedin",
  name: "Visites site PME",
  budget,
  audience,
  objectiveType: "WEBSITE_VISIT",
  format: "STANDARD_UPDATE",
  locale: { country: "FR", language: "fr" },
  creative: {
    introText: "Une solution professionnelle adaptée aux entreprises locales.",
    headline: "Découvrez notre offre",
    mediaBrief: "Visuel clair présentant le service et le résultat obtenu.",
    destinationUrl: "https://example.fr/solutions",
  },
};

const tikTok: TikTokAdsDraft = {
  schemaVersion: 1,
  channel: "tiktok",
  name: "Découverte locale",
  budget,
  audience,
  objectiveType: "TRAFFIC",
  format: "video",
  destinationKind: "website",
  placementIntent: "tiktok_only",
  optimizationIntent: "clicks",
  creative: {
    adText: "Découvrez le service en action",
    videoBrief: "Vidéo verticale montrant une démonstration authentique.",
    destinationUrl: "https://example.fr/solutions",
  },
};

const pinterest: PinterestAdsDraft = {
  schemaVersion: 1,
  channel: "pinterest",
  name: "Inspirations qui convertissent",
  budget,
  audience,
  objectiveType: "LEADS",
  intendedPromotionType: "STANDARD_AD",
  creativeType: "REGULAR",
  conversionEvent: "LEAD",
  creative: {
    pinTitle: "Un projet inspirant",
    pinDescription: "Une idée visuelle pour préparer votre projet.",
    visualBrief: "Image verticale, résultat concret et marque visible.",
    destinationUrl: "https://example.fr/solutions",
  },
};

const xDraft: XAdsDraft = {
  schemaVersion: 1,
  channel: "x",
  name: "Trafic vers le service",
  budget: { ...budget, level: "ad_group" },
  audience,
  objective: "website_traffic",
  format: "text",
  targetingMode: "broad",
  creative: {
    postText: "Votre prochain projet commence ici. Découvrez notre service.",
    mediaBrief: "",
    destinationUrl: "https://example.fr/solutions",
  },
};

test("all four channels distinguish a complete brief from unpublished status", () => {
  for (const draft of [linkedIn, tikTok, pinterest, xDraft]) {
    const result = assessAdsChannelDraft(draft);
    assert.equal(result.channel, draft.channel);
    assert.equal(result.briefComplete, true, `${draft.channel}: ${JSON.stringify(result.briefIssues)}`);
    assert.equal(result.publicationReady, false);
    assert.ok(result.publicationIssues.some((item) => item.code === "publisher_not_implemented"));
    assert.ok(result.publicationIssues.some((item) => item.code === "platform_access_unverified"));
  }
});

test("capability registry never advertises publishing; OAuth is not inferred", () => {
  assert.equal(isPlannedAdsChannel("google"), false);
  assert.equal(isPlannedAdsChannel("linkedin"), true);
  for (const channel of ADS_PLANNED_CHANNELS) {
    const capability = getPlannedAdsChannelCapability(channel);
    assert.equal(capability.briefSupported, true);
    assert.equal(capability.publicationEnabled, false);
    assert.equal(capability.publicationGate, "publisher_not_implemented");
    assert.ok(capability.officialReference.startsWith("https://"));
  }
});

test("even a complete brief with supplied external IDs cannot become publication-ready", () => {
  const withIds: LinkedInAdsDraft = {
    ...linkedIn,
    externalRefs: {
      adAccountUrn: "urn:li:sponsoredAccount:123456",
      campaignGroupUrn: "urn:li:sponsoredCampaignGroup:123456",
      organizationUrn: "urn:li:organization:123456",
      creativeAssetUrn: "urn:li:image:123456",
      geoUrns: ["urn:li:geo:123456"],
    },
  };
  const result = assessAdsChannelDraft(withIds);
  assert.equal(result.briefComplete, true);
  assert.equal(result.publicationReady, false);
  assert.ok(result.publicationIssues.some((item) => item.code === "platform_access_unverified"));
});

test("LinkedIn rejects objective/format mismatches and needs a conversion reference for conversion campaigns", () => {
  const wrong = assessAdsChannelDraft({ ...linkedIn, objectiveType: "VIDEO_VIEW", format: "TEXT_AD" });
  assert.equal(wrong.briefComplete, false);
  assert.ok(wrong.briefIssues.some((item) => item.code === "objective_format_mismatch"));
  const conversion = assessAdsChannelDraft({ ...linkedIn, objectiveType: "WEBSITE_CONVERSION" });
  assert.equal(conversion.briefComplete, true);
  assert.ok(conversion.publicationIssues.some((item) => item.field === "externalRefs.conversionUrn"));
});

test("TikTok website conversions need a defined event and verified Pixel before publication", () => {
  const incomplete = assessAdsChannelDraft({ ...tikTok, objectiveType: "WEB_CONVERSIONS" });
  assert.equal(incomplete.briefComplete, false);
  assert.ok(incomplete.briefIssues.some((item) => item.field === "creative.conversionEventBrief"));
  assert.ok(incomplete.publicationIssues.some((item) => item.field === "externalRefs.pixelId"));
  assert.ok(incomplete.publicationIssues.some((item) => item.field === "externalRefs.optimizationEvent"));
  const complete = assessAdsChannelDraft({
    ...tikTok,
    objectiveType: "WEB_CONVERSIONS",
    creative: { ...tikTok.creative, conversionEventBrief: "Demande de devis soumise" },
  });
  assert.equal(complete.briefComplete, true);
  assert.equal(complete.publicationReady, false);
});

test("Pinterest catalog and Pin drafts are separate and conversion events match the objective", () => {
  const mismatch = assessAdsChannelDraft({ ...pinterest, objectiveType: "AWARENESS", intendedPromotionType: "CATALOG", creativeType: "REGULAR" });
  assert.equal(mismatch.briefComplete, false);
  assert.ok(mismatch.briefIssues.some((item) => item.code === "objective_promotion_mismatch"));
  const catalog = assessAdsChannelDraft({ ...pinterest, objectiveType: "SALES", intendedPromotionType: "CATALOG", creativeType: undefined, conversionEvent: "CHECKOUT" });
  assert.equal(catalog.briefComplete, true, JSON.stringify(catalog.briefIssues));
  assert.ok(catalog.publicationIssues.some((item) => item.field === "externalRefs.catalogId"));
  assert.ok(catalog.publicationIssues.some((item) => item.field === "externalRefs.productGroupId"));
  assert.equal(catalog.publicationIssues.some((item) => item.field === "externalRefs.pinId"), false);
  const wrongEvent = assessAdsChannelDraft({ ...pinterest, conversionEvent: "CHECKOUT" });
  assert.ok(wrongEvent.briefIssues.some((item) => item.code === "invalid_conversion_event"));
  const irrelevantEvent = assessAdsChannelDraft({ ...pinterest, objectiveType: "AWARENESS", conversionEvent: "LEAD" });
  assert.ok(irrelevantEvent.briefIssues.some((item) => item.code === "invalid_conversion_event"));
});

test("X preserves its own alphanumeric account IDs and checks post length/keyword intent", () => {
  const withAccount = assessAdsChannelDraft({ ...xDraft, externalRefs: { adAccountId: "18ce54d4x5t" } });
  assert.equal(withAccount.briefComplete, true);
  assert.equal(withAccount.publicationReady, false);
  const tooLong = assessAdsChannelDraft({ ...xDraft, creative: { ...xDraft.creative, postText: "a".repeat(281) } });
  assert.ok(tooLong.briefIssues.some((item) => item.field === "creative.postText"));
  const noKeywords = assessAdsChannelDraft({ ...xDraft, targetingMode: "keywords", keywords: [] });
  assert.ok(noKeywords.briefIssues.some((item) => item.field === "keywords"));
});

test("invalid generic inputs fail closed instead of claiming a complete brief", () => {
  assert.equal(assessAdsChannelDraft({}).briefComplete, false);
  assert.equal(assessAdsChannelDraft({ channel: "google" }).publicationReady, false);
  const invalid = assessAdsChannelDraft({ ...linkedIn, schemaVersion: 2, budget: { ...budget, amount: -1 }, locale: { country: "France", language: "french" } });
  assert.equal(invalid.briefComplete, false);
  assert.ok(invalid.briefIssues.some((item) => item.code === "unsupported_schema"));
  assert.ok(invalid.briefIssues.some((item) => item.code === "invalid_budget"));
  assert.ok(invalid.briefIssues.some((item) => item.code === "invalid_locale"));
  const unrealisticBudget = assessAdsChannelDraft({ ...linkedIn, budget: { ...budget, amount: 900 } });
  assert.ok(unrealisticBudget.briefIssues.some((item) => item.code === "invalid_budget"));
  const untrustedUrl = assessAdsChannelDraft({ ...xDraft, creative: { ...xDraft.creative, destinationUrl: "http://example.fr" } });
  assert.ok(untrustedUrl.briefIssues.some((item) => item.code === "invalid_destination"));
});
