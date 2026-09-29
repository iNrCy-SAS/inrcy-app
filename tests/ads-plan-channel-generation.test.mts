import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adsCampaignPlanValidationIssueCodes,
  isReviewableAdsCampaignPlan,
  normalizeAdsCampaignPlan,
  normalizePlannedAdsChannelDraft,
  pinterestAdsCampaignPlanResponseSchema,
  plannedAdsChannelPlanPrompt,
  presentAdsCampaignRationale,
} from "../lib/adsCampaignPlan.ts";
import { assessAdsChannelDraft } from "../lib/adsChannelDrafts.ts";
import { adsChannelWizardSettingsFromBrief } from "../lib/adsChannelWizardSettings.ts";
import { unsupportedAdsConnectorReason } from "../lib/adsPublishMode.ts";

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
    targetingMode: "automatic",
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
    assert.deepEqual(
      plan.channelDraft?.audience.locationBriefs,
      channel === "pinterest" ? ["FR"] : trusted.locations,
    );
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

test("Pinterest automatic plans reduce historical local zones to the trusted business country", () => {
  const plan = normalizeAdsCampaignPlan({
    name: "Pinterest national",
    offer: "Accompagnement professionnel",
    targetLocations: ["Lille", "Roubaix", "Hauts-de-France"],
    channelDraft: drafts.pinterest,
  }, {
    provider: "pinterest",
    ...trusted,
    locations: ["Lille", "Roubaix", "Hauts-de-France"],
    country: "France",
  });

  assert.deepEqual(plan.targetLocations, ["FR"]);
  assert.deepEqual(plan.channelDraft?.audience.locationBriefs, ["FR"]);
});

test("Meta defaults to the publishable traffic path and both advertising image formats", () => {
  const plan = normalizeAdsCampaignPlan({
    name: "Accompagnement local",
    offer: "Accompagnement professionnel",
    primaryText: "Découvrez un accompagnement professionnel adapté à votre projet.",
    mediaBrief: "Montrer concrètement le service dans un contexte professionnel.",
  }, { provider: "meta", ...trusted });

  assert.equal(plan.campaignType, "meta_traffic");
  assert.equal(plan.objective, "website_traffic");
  assert.equal(plan.conversionGoal, "website_visit");
  assert.equal(plan.callToAction, "En savoir plus");
  assert.deepEqual(plan.metaPlacements, ["facebook_feed", "instagram_feed", "stories", "reels"]);
  assert.equal(plan.mediaStrategy, "image");
  assert.equal(plan.creativeType, "image");
});

test("the analysis rationale is never cut at an arbitrary 900-character boundary", () => {
  const rationale = "L’offre répond à un besoin professionnel mesurable. ".repeat(24).trim();
  assert.ok(rationale.length > 900);
  const plan = normalizeAdsCampaignPlan({ rationale }, { provider: "meta", ...trusted });
  assert.equal(plan.rationale, rationale);

  const overlyLongRationale = "Une recommandation contextualisée reste vérifiable. ".repeat(100);
  const bounded = normalizeAdsCampaignPlan({ rationale: overlyLongRationale }, { provider: "meta", ...trusted });
  assert.ok(bounded.rationale.length <= 4_000);
  assert.match(bounded.rationale, /[.!?…]$/);

  const oldCut = `${"Une phrase complète présente le choix stratégique. ".repeat(19)}Le`.slice(0, 900).padEnd(900, "x");
  const displayed = presentAdsCampaignRationale(oldCut);
  assert.match(displayed, /\.$/);
  assert.ok(displayed.length < oldCut.length);
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

test("a realistic Pinterest answer survives harmless provider JSON drift without weakening native validation", () => {
  const raw = {
    name: "Inspiration locale Pinterest",
    offer: "Accompagnement professionnel",
    objective: "website_traffic",
    conversionGoal: "website_visit",
    primaryText: "Découvrez une méthode claire pour préparer votre projet local.",
    mediaStrategy: "image",
    creativeType: "image",
    mediaBrief: "Image verticale montrant les étapes concrètes de l’accompagnement.",
    headlines: ["Préparez votre projet local"],
    descriptions: ["Une méthode claire et visuelle pour avancer."],
    keywords: ["préparer projet local", "idées accompagnement"],
    targetAudiences: ["Personnes préparant un projet local"],
    channelDraft: {
      schemaVersion: 1,
      channel: "Pinterest Ads",
      // Common multi-provider drift: JSON numbers/casing vary while the
      // actual strategic values remain explicit and valid.
      budget: { amount: "25,00", currency: "eur", period: "DAILY", level: "Campaign" },
      audience: { audienceBrief: "Personnes préparant un projet local" },
      objectiveType: "consideration",
      intendedPromotionType: "standard-ad",
      targetingMode: "AUTOMATIC",
      creativeType: "regular",
      conversionEvent: null,
      creative: {},
    },
  };
  const plan = normalizeAdsCampaignPlan(raw, { provider: "pinterest", ...trusted });
  assert.equal(isReviewableAdsCampaignPlan(plan, "pinterest"), true);
  const pinterestDraft = plan.channelDraft?.channel === "pinterest" ? plan.channelDraft : null;
  assert.ok(pinterestDraft);
  assert.equal(pinterestDraft.name, raw.name);
  assert.equal(pinterestDraft.budget.amount, 25);
  assert.equal(pinterestDraft.budget.currency, "EUR");
  assert.equal(pinterestDraft.budget.period, "daily");
  assert.equal(pinterestDraft.budget.level, "campaign");
  assert.equal(pinterestDraft.targetingMode, "automatic");
  assert.equal(pinterestDraft.creative.destinationUrl, trusted.destinationUrl);
  assert.equal(pinterestDraft.creative.pinTitle, raw.headlines[0]);
  assert.deepEqual(plan.keywords, []);
  assert.equal(unsupportedAdsConnectorReason({
    provider: "pinterest",
    campaignType: plan.campaignType,
    objective: plan.objective,
    conversionGoal: plan.conversionGoal,
    conversionLocation: plan.conversionLocation,
    bidStrategy: plan.bidStrategy,
    metaPlacements: plan.metaPlacements,
    callToAction: plan.callToAction,
    mediaStrategy: plan.mediaStrategy,
    creativeType: plan.creativeType,
    channelSettings: adsChannelWizardSettingsFromBrief(pinterestDraft),
    creativeUrl: "https://cdn.example.fr/pinterest/image.jpg",
    keywords: plan.keywords,
  }), null);
  assert.deepEqual(adsCampaignPlanValidationIssueCodes(raw, { provider: "pinterest", ...trusted }), []);
});

test("manual Pinterest targeting modes retain their planning signals", () => {
  for (const targetingMode of ["interests", "keywords", "audiences"] as const) {
    const signals = [`signal ${targetingMode}`, "projet local"];
    const plan = normalizeAdsCampaignPlan({
      name: "Signaux Pinterest manuels",
      offer: "Accompagnement professionnel",
      objective: "website_traffic",
      conversionGoal: "website_visit",
      primaryText: "Découvrez une méthode claire pour préparer votre projet local.",
      mediaStrategy: "image",
      creativeType: "image",
      mediaBrief: "Image verticale montrant les étapes concrètes de l’accompagnement.",
      headlines: ["Préparez votre projet local"],
      descriptions: ["Une méthode claire et visuelle pour avancer."],
      keywords: signals,
      channelDraft: { ...drafts.pinterest, objectiveType: "CONSIDERATION", conversionEvent: null, targetingMode },
    }, { provider: "pinterest", ...trusted });
    assert.deepEqual(plan.keywords, signals, targetingMode);
    assert.equal(plan.channelDraft?.channel === "pinterest" ? plan.channelDraft.targetingMode : null, targetingMode);
  }
});

test("Pinterest semantic failures expose only stable issue codes", () => {
  const raw = {
    name: "Ventes Pinterest",
    offer: "Accompagnement professionnel",
    objective: "sales",
    conversionGoal: "website_visit",
    primaryText: "Découvrez notre accompagnement professionnel.",
    mediaStrategy: "image",
    creativeType: "image",
    mediaBrief: "Image verticale montrant le service dans un contexte réel.",
    headlines: ["Un projet accompagné"],
    descriptions: ["Une méthode professionnelle à découvrir."],
    channelDraft: {
      ...drafts.pinterest,
      objectiveType: "SALES",
      conversionEvent: null,
    },
  };
  const issues = adsCampaignPlanValidationIssueCodes(raw, { provider: "pinterest", ...trusted });
  assert.ok(issues.includes("native_invalid_conversion_event"));
  assert.equal(issues.some((issue) => issue.includes("Accompagnement")), false);
});

test("Pinterest generation uses a strict native response schema", () => {
  const response = pinterestAdsCampaignPlanResponseSchema();
  assert.equal(response.strict, true);
  const root = response.schema as { required: string[]; properties: Record<string, unknown> };
  assert.ok(root.required.includes("channelDraft"));
  const channelDraft = root.properties.channelDraft as {
    required: string[];
    properties: Record<string, { enum?: unknown[]; type?: unknown }>;
  };
  for (const field of ["objectiveType", "intendedPromotionType", "targetingMode", "creativeType", "conversionEvent", "budget", "audience", "creative"]) {
    assert.ok(channelDraft.required.includes(field), field);
  }
  assert.deepEqual(channelDraft.properties.targetingMode.enum, ["automatic", "interests", "keywords", "audiences"]);
  assert.deepEqual(channelDraft.properties.creativeType.type, ["string", "null"]);
  assert.deepEqual(channelDraft.properties.conversionEvent.type, ["string", "null"]);
  assert.equal(Object.hasOwn(channelDraft.properties, "externalRefs"), false);
});

test("native prompts demand a brief only and do not assert publication access", () => {
  for (const channel of ["linkedin", "tiktok", "pinterest", "x"] as const) {
    const prompt = plannedAdsChannelPlanPrompt(channel);
    if (channel === "pinterest") {
      assert.match(prompt, /publication réelle/);
      assert.match(prompt, /targetingMode="automatic"/);
      assert.match(prompt, /keywords=\[\]/);
      assert.doesNotMatch(prompt, /aucun adaptateur de publication/);
    } else {
      assert.match(prompt, /BROUILLON/);
      assert.match(prompt, /aucun adaptateur de publication/);
    }
    assert.match(prompt, /N’ajoute PAS externalRefs/);
    assert.match(prompt, /channelDraft/);
    assert.match(prompt, /pas les limites Google de 30\/90/);
  }
});
