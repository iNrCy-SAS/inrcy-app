import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADS_CHANNEL_DRAFT_MAX_BYTES,
  parseAdsCampaignInput,
} from "../lib/adsValidation.ts";
import { normalizePlannedAdsChannelDraft } from "../lib/adsCampaignPlan.ts";

const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
const budget = { amount: 30, currency: "EUR", period: "daily", level: "campaign" };
const audience = { locationBriefs: ["Lyon, France"], audienceBrief: "Entreprises locales cherchant un accompagnement professionnel" };
const creativeUrl = "https://atelier.example/offre";

const channelDrafts = {
  linkedin: {
    schemaVersion: 1, channel: "linkedin", name: "Service LinkedIn Lyon", budget, audience,
    objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", locale: { country: "FR", language: "fr" },
    creative: { introText: "Une aide professionnelle pour les entreprises lyonnaises.", headline: "Découvrez le service", mediaBrief: "Visuel à créer autour du service et de l’équipe.", destinationUrl: creativeUrl },
  },
  tiktok: {
    schemaVersion: 1, channel: "tiktok", name: "Service TikTok Lyon", budget, audience,
    objectiveType: "TRAFFIC", format: "video", destinationKind: "website", placementIntent: "tiktok_only", optimizationIntent: "clicks",
    creative: { adText: "Découvrez le service", videoBrief: "Vidéo verticale à créer montrant l’équipe en action.", destinationUrl: creativeUrl },
  },
  pinterest: {
    schemaVersion: 1, channel: "pinterest", name: "Service Pinterest Lyon", budget, audience,
    objectiveType: "LEADS", intendedPromotionType: "STANDARD_AD", creativeType: "REGULAR", conversionEvent: "LEAD",
    creative: { pinTitle: "Un projet bien accompagné", pinDescription: "Une idée à découvrir pour mieux préparer votre projet.", visualBrief: "Image verticale à créer avec une illustration concrète du service.", destinationUrl: creativeUrl },
  },
  x: {
    schemaVersion: 1, channel: "x", name: "Service X Lyon", budget: { ...budget, level: "ad_group" }, audience,
    objective: "website_traffic", format: "text", targetingMode: "broad",
    creative: { postText: "Un projet professionnel à Lyon ? Découvrez notre accompagnement.", mediaBrief: "", destinationUrl: creativeUrl },
  },
} as const;

function campaign(provider: string, channelDraft?: unknown) {
  return {
    provider,
    creationMode: "inrcy",
    adAccountId: "",
    accountCurrency: "EUR",
    name: `Brouillon ${provider}`,
    offer: "Accompagnement professionnel",
    dailyBudgetEuros: 10,
    endDate,
    destinationUrl: creativeUrl,
    targetLocations: ["Lyon, France"],
    targetAudiences: ["Entreprises locales"],
    headlines: [], descriptions: [], keywords: [], negativeKeywords: [],
    ...(channelDraft === undefined ? {} : { channelDraft }),
  };
}

test("les quatre briefs survivent au cycle sauvegarde JSON et réouverture", () => {
  for (const provider of ["linkedin", "tiktok", "pinterest", "x"] as const) {
    const first = parseAdsCampaignInput(campaign(provider, channelDrafts[provider]), { purpose: "draft" });
    assert.equal(first.error, null, provider);
    assert.deepEqual(first.draft?.channelDraft, channelDrafts[provider]);

    // `ads_campaigns.draft` is JSONB; the route writes the parsed draft and GET
    // returns that field. This mimics the storage/reopen serialization boundary.
    const storedJson = JSON.stringify(first.draft);
    const reopened = parseAdsCampaignInput(JSON.parse(storedJson), { purpose: "draft" });
    assert.equal(reopened.error, null, provider);
    assert.deepEqual(reopened.draft?.channelDraft, first.draft?.channelDraft);
    assert.equal(parseAdsCampaignInput(campaign(provider, channelDrafts[provider]), { purpose: "publish" }).draft, null);
  }
});

test("les briefs normalisés par la génération sont acceptés au stockage", () => {
  for (const provider of ["linkedin", "tiktok", "pinterest", "x"] as const) {
    const generated = normalizePlannedAdsChannelDraft(channelDrafts[provider], {
      provider,
      destinationUrl: creativeUrl,
      locations: ["Lyon, France"],
      audiences: ["Entreprises locales"],
    });
    assert.ok(generated, provider);
    const parsed = parseAdsCampaignInput(campaign(provider, generated), { purpose: "draft" });
    assert.equal(parsed.error, null, provider);
    assert.deepEqual(parsed.draft?.channelDraft, JSON.parse(JSON.stringify(generated)));
  }
});

test("un brief est facultatif en mode manuel et Google/Meta restent inchangés", () => {
  const noBrief = parseAdsCampaignInput(campaign("linkedin"), { purpose: "draft" });
  assert.equal(noBrief.error, null);
  assert.equal(noBrief.draft?.channelDraft, undefined);
  for (const provider of ["google", "meta"]) {
    const standard = parseAdsCampaignInput(campaign(provider), { purpose: "draft" });
    assert.equal(standard.error, null);
    assert.equal(standard.draft?.channelDraft, undefined);
    assert.match(parseAdsCampaignInput(campaign(provider, channelDrafts.linkedin), { purpose: "draft" }).error || "", /n’accepte pas/);
  }
});

test("un brief incorrect, surdimensionné ou non sérialisable est refusé", () => {
  const mismatch = parseAdsCampaignInput(campaign("linkedin", channelDrafts.tiktok), { purpose: "draft" });
  assert.match(mismatch.error || "", /correspond pas/);
  const wrongVersion = parseAdsCampaignInput(campaign("linkedin", { ...channelDrafts.linkedin, schemaVersion: 2 }), { purpose: "draft" });
  assert.match(wrongVersion.error || "", /version/);
  const incomplete = parseAdsCampaignInput(campaign("linkedin", { ...channelDrafts.linkedin, format: "SINGLE_VIDEO", objectiveType: "LEAD_GENERATION" }), { purpose: "draft" });
  assert.match(incomplete.error || "", /incomplet/);
  const oversized = parseAdsCampaignInput(campaign("linkedin", {
    ...channelDrafts.linkedin,
    audience: { ...audience, audienceBrief: "a".repeat(ADS_CHANNEL_DRAFT_MAX_BYTES) },
  }), { purpose: "draft" });
  assert.match(oversized.error || "", /taille/);
  const cyclic: Record<string, unknown> = { ...channelDrafts.linkedin };
  cyclic.self = cyclic;
  assert.match(parseAdsCampaignInput(campaign("linkedin", cyclic), { purpose: "draft" }).error || "", /JSON/);
});

test("aucun externalRefs fourni par IA ou client ne franchit le stockage", () => {
  const withRefs = parseAdsCampaignInput(campaign("linkedin", {
    ...channelDrafts.linkedin,
    externalRefs: { adAccountUrn: "urn:li:sponsoredAccount:12345" },
  }), { purpose: "draft" });
  assert.match(withRefs.error || "", /identifiants publicitaires/);
  const nestedRefs = parseAdsCampaignInput(campaign("tiktok", {
    ...channelDrafts.tiktok,
    creative: { ...channelDrafts.tiktok.creative, note: { externalRefs: { pixelId: "invented" } } },
  }), { purpose: "draft" });
  assert.match(nestedRefs.error || "", /identifiants publicitaires/);
  const alternateSpelling = parseAdsCampaignInput(campaign("pinterest", {
    ...channelDrafts.pinterest,
    external_refs: { adAccountId: "invented" },
  }), { purpose: "draft" });
  assert.match(alternateSpelling.error || "", /identifiants publicitaires/);
});

test("aucun identifiant ou champ inattendu ne peut être caché dans le brief", () => {
  const inventedAccount = parseAdsCampaignInput(campaign("linkedin", {
    ...channelDrafts.linkedin,
    adAccountUrn: "urn:li:sponsoredAccount:12345",
  }), { purpose: "draft" });
  assert.match(inventedAccount.error || "", /champs inattendus/);
  const inventedAsset = parseAdsCampaignInput(campaign("tiktok", {
    ...channelDrafts.tiktok,
    creative: { ...channelDrafts.tiktok.creative, assetId: "invented" },
  }), { purpose: "draft" });
  assert.match(inventedAsset.error || "", /champs inattendus/);
});
