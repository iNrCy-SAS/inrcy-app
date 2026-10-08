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
      rationale: "L’accompagnement répond aux besoins des entreprises de Lyon. Le format présente une étape concrète et invite à consulter l’offre, sans présumer du suivi des conversions.",
      campaignType: "generic",
      channelDraft: drafts[channel],
    }, { provider: channel, ...trusted });
    assert.equal(isReviewableAdsCampaignPlan(plan, channel), true, channel);
    assert.equal(plan.channelDraft?.channel, channel);
    assert.equal(plan.channelDraft?.creative.destinationUrl, trusted.destinationUrl);
    assert.deepEqual(
      plan.channelDraft?.audience.locationBriefs,
      trusted.locations,
    );
    assert.equal("externalRefs" in (plan.channelDraft || {}), false);
    assert.equal(assessAdsChannelDraft(plan.channelDraft).publicationReady, false);
    assert.ok(plan.primaryText);
    assert.ok(plan.mediaBrief || channel === "x");
  }
});

test("overlong copy remains whole and is rejected instead of being clipped to channel limits", () => {
  const longHeadline = "H".repeat(120);
  const longDescription = "D".repeat(220);
  const pinterest = normalizeAdsCampaignPlan({
    name: "Pinterest",
    offer: "Accompagnement professionnel",
    headlines: [longHeadline],
    descriptions: [longDescription],
    channelDraft: { ...drafts.pinterest, creative: { ...drafts.pinterest.creative, pinTitle: longHeadline, pinDescription: longDescription } },
  }, { provider: "pinterest", ...trusted });
  assert.equal(pinterest.headlines[0], longHeadline);
  assert.equal(pinterest.descriptions[0].length, 220);
  assert.equal(isReviewableAdsCampaignPlan(pinterest, "pinterest"), false);
  const linkedin = normalizeAdsCampaignPlan({
    name: "LinkedIn",
    offer: "Accompagnement professionnel",
    headlines: [longHeadline],
    descriptions: [longDescription],
    channelDraft: drafts.linkedin,
  }, { provider: "linkedin", ...trusted });
  assert.equal(linkedin.headlines.find((headline) => headline.startsWith("H"))?.length, 120);
  assert.equal(linkedin.descriptions.find((description) => /^D+$/.test(description))?.length, 220);
  const google = normalizeAdsCampaignPlan({ headlines: [longHeadline], descriptions: [longDescription] }, { provider: "google", ...trusted });
  assert.equal(google.headlines[0], longHeadline);
  assert.equal(google.descriptions[0], longDescription);
  assert.equal(isReviewableAdsCampaignPlan(google, "google"), false);
  assert.equal(google.channelDraft, undefined);
});

test("LinkedIn keeps useful signals while discarding model-invented geography", () => {
  const plan = normalizeAdsCampaignPlan({
    name: "LinkedIn local",
    offer: "Accompagnement professionnel",
    keywords: [],
    targetLocations: ["Arras"],
    targetAudiences: ["Dirigeants de PME locales"],
    channelDraft: drafts.linkedin,
  }, { provider: "linkedin", ...trusted });

  assert.ok(plan.keywords.length > 0);
  assert.ok(plan.keywords.includes("Dirigeants de PME locales"));
  assert.ok(plan.keywords.includes("Lyon, France"));
  assert.equal(plan.keywords.includes("Arras"), false);
  assert.deepEqual(plan.targetLocations, trusted.locations);
  assert.ok(plan.keywords.every((signal) => signal.length <= 80));
});

test("automatic plans fill every generatable studio block without fabricating platform resources", () => {
  const sparseNativeDrafts = {
    linkedin: {
      ...drafts.linkedin,
      name: "",
      audience: { locationBriefs: ["Zone inventée"], audienceBrief: "" },
      creative: { ...drafts.linkedin.creative, introText: "", headline: "", mediaBrief: "" },
    },
    tiktok: {
      ...drafts.tiktok,
      name: "",
      audience: { locationBriefs: ["Zone inventée"], audienceBrief: "" },
      creative: { ...drafts.tiktok.creative, adText: "", videoBrief: "" },
    },
    pinterest: {
      ...drafts.pinterest,
      name: "",
      audience: { locationBriefs: ["Zone inventée"], audienceBrief: "" },
      creative: { ...drafts.pinterest.creative, pinTitle: "", pinDescription: "", visualBrief: "" },
    },
    x: {
      ...drafts.x,
      name: "",
      audience: { locationBriefs: ["Zone inventée"], audienceBrief: "" },
      creative: { ...drafts.x.creative, postText: "", mediaBrief: "" },
    },
  } as const;
  const cases = [
    { provider: "google", raw: { campaignType: "search" } },
    { provider: "meta", raw: { campaignType: "meta_traffic" } },
    ...(["linkedin", "tiktok", "pinterest", "x"] as const).map((provider) => ({
      provider,
      raw: { campaignType: "generic", channelDraft: sparseNativeDrafts[provider] },
    })),
  ] as const;

  for (const { provider, raw } of cases) {
    const plan = normalizeAdsCampaignPlan({
      ...raw,
      offer: "Accompagnement professionnel",
      destinationUrl: "https://invented.example/landing",
      urlExclusions: ["https://invented.example/exclusion"],
      targetLocations: ["Zone inventée"],
      imageUrl: "https://invented.example/image.jpg",
      creativeUrl: "https://invented.example/video.mp4",
      adAccountId: "invented-account",
      notEuPoliticalConfirmed: true,
    }, { provider, ...trusted });

    assert.equal(isReviewableAdsCampaignPlan(plan, provider), true, provider);
    assert.ok(plan.name, `${provider}: name`);
    assert.ok(plan.offer, `${provider}: offer`);
    assert.ok(plan.targetAudiences.length > 0, `${provider}: audience`);
    assert.ok(plan.primaryText, `${provider}: primary text`);
    assert.ok(plan.headlines.length > 0, `${provider}: headlines`);
    assert.ok(plan.descriptions.length > 0, `${provider}: descriptions`);
    assert.deepEqual(plan.targetLocations, trusted.locations, `${provider}: trusted geo only`);
    assert.equal(plan.destinationUrl, trusted.destinationUrl, `${provider}: trusted destination only`);
    assert.deepEqual(plan.urlExclusions, [], `${provider}: no invented URL exclusions`);
    assert.equal(plan.imageUrl, "", `${provider}: no invented image asset`);
    assert.equal(plan.creativeUrl, "", `${provider}: no invented creative asset`);
    assert.equal(Object.hasOwn(plan, "adAccountId"), false, `${provider}: no account resource`);
    assert.equal(Object.hasOwn(plan, "notEuPoliticalConfirmed"), false, `${provider}: no compliance attestation`);

    if (provider === "google") {
      assert.equal(plan.mediaStrategy, "search_text");
      assert.equal(plan.mediaBrief, "");
      assert.ok(plan.headlines.length >= 6);
      assert.ok(plan.descriptions.length >= 3);
      assert.ok(plan.keywords.length >= 6);
    } else if (provider === "pinterest" || provider === "meta" || provider === "tiktok") {
      assert.deepEqual(plan.keywords, []);
      assert.ok(plan.mediaBrief);
    } else {
      assert.ok(plan.keywords.length > 0, `${provider}: human-readable signals`);
      assert.ok(plan.mediaBrief, `${provider}: media brief`);
    }

    if (plan.channelDraft) {
      assert.equal("externalRefs" in plan.channelDraft, false, `${provider}: no native external refs`);
      assert.ok(plan.channelDraft.audience.audienceBrief, `${provider}: native audience`);
      assert.equal(plan.name, plan.channelDraft.name, `${provider}: native name projection`);
      assert.equal(plan.targetAudiences[0], plan.channelDraft.audience.audienceBrief, `${provider}: native audience projection`);
      assert.equal(plan.channelDraft.audience.locationBriefs.includes("Zone inventée"), false, `${provider}: no native invented geo`);
      assert.equal(plan.channelDraft.creative.destinationUrl, trusted.destinationUrl, `${provider}: native trusted destination`);
      switch (plan.channelDraft.channel) {
        case "linkedin":
          assert.equal(plan.primaryText, plan.channelDraft.creative.introText);
          assert.equal(plan.headlines[0], plan.channelDraft.creative.headline);
          assert.equal(plan.mediaBrief, plan.channelDraft.creative.mediaBrief);
          break;
        case "tiktok":
          assert.equal(plan.primaryText, plan.channelDraft.creative.adText);
          assert.equal(plan.mediaBrief, plan.channelDraft.creative.videoBrief);
          break;
        case "pinterest":
          assert.equal(plan.primaryText, plan.channelDraft.creative.pinDescription);
          assert.equal(plan.headlines[0], plan.channelDraft.creative.pinTitle);
          assert.equal(plan.mediaBrief, plan.channelDraft.creative.visualBrief);
          break;
        case "x":
          assert.equal(plan.primaryText, plan.channelDraft.creative.postText);
          assert.equal(plan.mediaBrief, plan.channelDraft.creative.mediaBrief);
          assert.match(plan.channelDraft.creative.mediaBrief, /Non requis/);
          break;
      }
    }

    const withoutTrustedResources = normalizeAdsCampaignPlan({
      ...raw,
      offer: "Accompagnement professionnel",
      destinationUrl: "https://invented.example/landing",
      targetLocations: ["Zone inventée"],
    }, {
      provider,
      companyName: trusted.companyName,
      audiences: trusted.audiences,
      services: trusted.services,
    });
    assert.equal(withoutTrustedResources.destinationUrl, "", `${provider}: no unverified destination fallback`);
    assert.deepEqual(withoutTrustedResources.targetLocations, [], `${provider}: no unverified geo fallback`);
  }
});

test("Pinterest automatic plans retain local service areas without widening to a country", () => {
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

  assert.deepEqual(plan.targetLocations, ["Lille", "Roubaix"]);
  assert.deepEqual(plan.channelDraft?.audience.locationBriefs, ["Lille", "Roubaix"]);
});

test("Pinterest presents the one native title and description that the Pin publisher uses", () => {
  const plan = normalizeAdsCampaignPlan({
    name: "Pinterest local", offer: "Projet local", primaryText: "Synthèse différente",
    headlines: ["Variante A", "Variante B"], descriptions: ["Description A", "Description B"],
    channelDraft: drafts.pinterest,
  }, { provider: "pinterest", ...trusted });
  assert.deepEqual(plan.headlines, [drafts.pinterest.creative.pinTitle]);
  assert.deepEqual(plan.descriptions, [drafts.pinterest.creative.pinDescription]);
  assert.equal(plan.primaryText, drafts.pinterest.creative.pinDescription);
  const properties = pinterestAdsCampaignPlanResponseSchema().schema.properties as Record<string, { maxItems?: number }>;
  assert.equal(properties.headlines.maxItems, 1);
  assert.equal(properties.descriptions.maxItems, 1);
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
    rationale: "L’épingle aide les professionnels locaux à préparer leur projet en présentant une méthode concrète. La visite du site permet de découvrir l’accompagnement ; les résultats restent à vérifier après diffusion.",
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
      assert.match(prompt, /portrait 4:5 \(1080×1350\)/);
      assert.doesNotMatch(prompt, /2:3/);
      assert.doesNotMatch(prompt, /aucun adaptateur de publication/);
    } else {
      assert.match(prompt, /BROUILLON/);
      assert.match(prompt, /vérifiés par le connecteur/);
      assert.doesNotMatch(prompt, /aucun adaptateur de publication/);
    }
    assert.match(prompt, /N’ajoute PAS externalRefs/);
    assert.match(prompt, /channelDraft/);
    assert.match(prompt, /pas les limites Google de 30\/90/);
  }
});
