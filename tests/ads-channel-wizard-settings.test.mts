import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultAdsChannelWizardSettings,
  parseAdsChannelWizardSettings,
} from "../lib/adsChannelWizardSettings.ts";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";

const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
const channels = ["linkedin", "tiktok", "pinterest", "x"] as const;

function campaign(provider: string, channelSettings: unknown) {
  return {
    provider, creationMode: "manual", campaignType: "generic", objective: "website_traffic",
    conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "maximize_clicks",
    adAccountId: "", accountCurrency: "EUR", name: "Campagne de test", offer: "Service local",
    dailyBudgetEuros: 30, endDate, destinationUrl: "https://example.fr/offre",
    targetLocations: ["Lyon"], targetAudiences: ["Professionnels"], languages: ["fr"],
    metaPlacements: [], primaryText: "Découvrez notre service", mediaStrategy: "image",
    headlines: [], descriptions: [], keywords: [], negativeKeywords: [], channelSettings,
  };
}

test("les choix natifs des quatre canaux survivent à l’enregistrement et à la réouverture", () => {
  const choices = {
    linkedin: { ...defaultAdsChannelWizardSettings("linkedin"), objectiveType: "VIDEO_VIEW", format: "SINGLE_VIDEO", targetingFacet: "skills" },
    tiktok: { ...defaultAdsChannelWizardSettings("tiktok"), objectiveType: "LEAD_GENERATION", optimizationIntent: "leads", destinationKind: "instant_form", placementIntent: "automatic", targetingMode: "interests" },
    pinterest: { ...defaultAdsChannelWizardSettings("pinterest"), objectiveType: "SALES", intendedPromotionType: "CATALOG", creativeType: null, targetingMode: "keywords", conversionEvent: "CHECKOUT" },
    x: { ...defaultAdsChannelWizardSettings("x"), objective: "video_views", format: "video", targetingMode: "follower_lookalikes" },
  } as const;
  for (const provider of channels) {
    const settings = choices[provider];
    const first = parseAdsCampaignInput(campaign(provider, settings), { purpose: "draft" });
    assert.equal(first.error, null, provider);
    assert.deepEqual(first.draft?.channelSettings, settings);
    const reopened = parseAdsCampaignInput(JSON.parse(JSON.stringify(first.draft)), { purpose: "draft" });
    assert.equal(reopened.error, null, provider);
    assert.deepEqual(reopened.draft?.channelSettings, settings);
    assert.equal(parseAdsCampaignInput(campaign(provider, settings), { purpose: "publish" }).draft, null);
  }
});

test("le serveur rejette les champs ajoutés, les identifiants et les canaux incohérents", () => {
  const linkedin = defaultAdsChannelWizardSettings("linkedin");
  assert.match(parseAdsCampaignInput(campaign("linkedin", { ...linkedin, externalRefs: { adAccountUrn: "invented" } }), { purpose: "draft" }).error || "", /identifiants/);
  assert.match(parseAdsCampaignInput({ ...campaign("linkedin", linkedin), externalRefs: { campaignId: "invented" } }, { purpose: "draft" }).error || "", /identifiants/);
  assert.match(parseAdsCampaignInput(campaign("linkedin", { ...linkedin, hiddenPermission: true }), { purpose: "draft" }).error || "", /incompatibles/);
  assert.match(parseAdsCampaignInput(campaign("x", linkedin), { purpose: "draft" }).error || "", /correspondent pas/);
  assert.match(parseAdsCampaignInput(campaign("google", linkedin), { purpose: "draft" }).error || "", /n’accepte pas/);
});

test("les combinaisons natives incompatibles échouent avant le stockage", () => {
  const linkedin = defaultAdsChannelWizardSettings("linkedin");
  const tiktok = defaultAdsChannelWizardSettings("tiktok");
  const pinterest = defaultAdsChannelWizardSettings("pinterest");
  const x = defaultAdsChannelWizardSettings("x");
  assert.ok(parseAdsChannelWizardSettings({ ...linkedin, objectiveType: "VIDEO_VIEW", format: "TEXT_AD" }, "linkedin").error);
  assert.ok(parseAdsChannelWizardSettings({ ...tiktok, objectiveType: "WEB_CONVERSIONS", destinationKind: "profile", optimizationIntent: "conversions" }, "tiktok").error);
  assert.ok(parseAdsChannelWizardSettings({ ...pinterest, objectiveType: "VIDEO_COMPLETION", creativeType: "REGULAR" }, "pinterest").error);
  assert.ok(parseAdsChannelWizardSettings({ ...pinterest, objectiveType: "LEADS", intendedPromotionType: "CATALOG", creativeType: null, conversionEvent: "LEAD" }, "pinterest").error);
  assert.ok(parseAdsChannelWizardSettings({ ...x, objective: "video_views", format: "text" }, "x").error);
});

test("un choix manuel modifié ne conserve pas un ancien brief IA TikTok", () => {
  const settings = defaultAdsChannelWizardSettings("tiktok");
  const channelDraft = {
    schemaVersion: 1, channel: "tiktok", name: "Campagne de test",
    budget: { amount: 30, currency: "EUR", period: "daily", level: "campaign" },
    audience: { locationBriefs: ["Lyon"], audienceBrief: "Professionnels à Lyon" },
    objectiveType: "TRAFFIC", format: "video", destinationKind: "website",
    placementIntent: "tiktok_only", optimizationIntent: "clicks",
    creative: { adText: "Découvrez le service", videoBrief: "Vidéo verticale avec une démonstration.", destinationUrl: "https://example.fr/offre" },
  };
  const same = parseAdsCampaignInput({ ...campaign("tiktok", settings), channelDraft }, { purpose: "draft" });
  assert.ok(same.draft?.channelDraft);
  const changed = parseAdsCampaignInput({ ...campaign("tiktok", { ...settings, placementIntent: "automatic" }), channelDraft }, { purpose: "draft" });
  assert.equal(changed.error, null);
  assert.equal(changed.draft?.channelDraft, undefined);
  assert.equal(changed.draft?.channelSettings?.channel, "tiktok");
  const newAudience = parseAdsCampaignInput({ ...campaign("tiktok", { ...settings, targetingMode: "interests" }), channelDraft }, { purpose: "draft" });
  assert.equal(newAudience.error, null);
  assert.equal(newAudience.draft?.channelDraft, undefined);
});
