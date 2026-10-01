import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adsAccessAllowed } from "../lib/adsAccessPolicy.ts";
import { adsDraftHasKeywordsStep, adsDraftHasMediaStep } from "../lib/adsDraftNavigation.ts";
import { isAdsChannelPublishEnabled, openaiDraftRetrySafe, unsupportedAdsConnectorReason } from "../lib/adsPublishMode.ts";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";

const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
const chatgptDraft = {
  provider: "openai",
  accountCurrency: "EUR",
  adAccountId: "adacct_example123",
  campaignType: "generic",
  objective: "website_traffic",
  conversionGoal: "website_visit",
  conversionLocation: "website",
  mediaStrategy: "image",
  creativeType: "image",
  bidStrategy: "manual_review",
  name: "Carte locale Lille",
  offer: "Diagnostic de rénovation énergétique",
  dailyBudgetEuros: 15,
  openaiBidEuros: 1.5,
  endDate,
  destinationUrl: "https://example.com/diagnostic",
  targetLocations: ["Lille"],
  targetAudiences: ["Propriétaires de maison"],
  primaryText: "Découvrez un diagnostic adapté à votre maison à Lille.",
  headlines: ["Rénovez avec un diagnostic clair"],
  descriptions: ["Découvrez un diagnostic adapté à votre maison à Lille."],
  imageUrl: "https://example.com/carte.jpg",
  creativeUrl: "https://example.com/carte.jpg",
};

test("ChatGPT Ads est ouvert aux comptes Premium et Founder, avec des gardes indépendantes Active et En pause", () => {
  assert.equal(adsAccessAllowed("premium", false, "openai"), true);
  assert.equal(adsAccessAllowed("founder", false, "openai"), true);
  assert.equal(adsAccessAllowed("standard", false, "openai"), false);
  assert.equal(adsAccessAllowed("standard", true, "openai"), true);
  const gate = {
    INRCY_OPENAI_ADS_PAUSED_PUBLISH_ENABLED: "true",
    INRCY_OPENAI_ADS_LIVE_PUBLISH_ENABLED: "true",
  };
  assert.equal(isAdsChannelPublishEnabled("openai", "paused", gate), true);
  assert.equal(isAdsChannelPublishEnabled("openai", "live", gate), true);
  assert.equal(isAdsChannelPublishEnabled("openai", "demo_paused", gate), false);
  assert.equal(isAdsChannelPublishEnabled("openai", "live", {}), true);
  assert.equal(isAdsChannelPublishEnabled("openai", "live", { INRCY_ADS_LIVE_PUBLISH_ENABLED: "true" }), true);
  assert.equal(isAdsChannelPublishEnabled("openai", "live", { INRCY_OPENAI_ADS_LIVE_PUBLISH_ENABLED: "false" }), false);
  assert.equal(isAdsChannelPublishEnabled("openai", "paused", {}), true);
  assert.equal(isAdsChannelPublishEnabled("openai", "paused", { INRCY_OPENAI_ADS_PAUSED_PUBLISH_ENABLED: "false" }), false);
});

test("le lancement Active ChatGPT Ads exige facturation confirmée, crée en pause puis active la campagne en dernier", () => {
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  const connector = readFileSync(new URL("../lib/adsOpenaiConnector.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../supabase/migrations/20261001223234_enable_chatgpt_ads_live_campaigns.sql", import.meta.url),
    "utf8",
  );
  assert.match(route, /body\?\.billingConfirmed !== true/);
  assert.match(route, /OPENAI_ADS_BILLING_CONFIRMATION_REQUIRED/);
  assert.ok(route.indexOf("createPausedOpenaiAdsCampaign") < route.indexOf("activateOpenaiAdsCampaign({"));
  assert.match(route, /billingConfirmed: body\?\.billingConfirmed === true/);
  assert.ok(connector.indexOf("`/ads/${progress.adId}/activate`")
    < connector.indexOf("`/ad_groups/${progress.adGroupId}/activate`"));
  assert.ok(connector.indexOf("`/ad_groups/${progress.adGroupId}/activate`")
    < connector.indexOf("`/campaigns/${progress.campaignId}/activate`"));
  assert.match(connector, /openaiAdsReviewAllowsActivation\(state\.reviewStatus\)/);
  assert.match(migration, /'openai'::text/);
  assert.doesNotMatch(migration, /provider = 'openai' and status in/);
  assert.match(migration, /status = 'draft' and ad_account_id = ''/);
});

test("la carte ChatGPT validée garde sa zone locale, son texte entier et son enchère", () => {
  const parsed = parseAdsCampaignInput(chatgptDraft, { purpose: "publish" });
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.draft?.targetLocations, ["Lille"]);
  assert.equal(parsed.draft?.primaryText, chatgptDraft.primaryText);
  assert.equal(parsed.draft?.openaiBidEuros, 1.5);
  assert.equal(unsupportedAdsConnectorReason(parsed.draft!), null);
});

test("la création ChatGPT refuse les paramètres qui seraient élargis ou dénaturés", () => {
  const invalid = [
    { change: { targetLocations: [] }, expected: /zone locale/ },
    { change: { dailyBudgetEuros: 10 }, expected: /15 €/ },
    { change: { openaiBidEuros: 16 }, expected: /enchère ChatGPT Ads/ },
    { change: { objective: "awareness" }, expected: /clics vers votre site/ },
    { change: { conversionGoal: "lead_form" }, expected: /clics vers votre site/ },
    { change: { bidStrategy: "maximize_clicks" }, expected: /clics vers votre site/ },
    { change: { trackingParameters: "utm_source=inrcy" }, expected: /ne les transmet pas/ },
    { change: { keywords: ["rénovation"] }, expected: /ne les transmet pas/ },
    { change: { headlines: ["x".repeat(51)] }, expected: /nombre et la longueur/ },
    { change: { primaryText: "x".repeat(101) }, expected: /100 caractères/ },
    { change: { mediaStrategy: "video" }, expected: /carte image/ },
  ];
  for (const { change, expected } of invalid) {
    const result = parseAdsCampaignInput({ ...chatgptDraft, ...change }, { purpose: "publish" });
    assert.equal(result.draft, null);
    assert.match(result.error || "", expected);
  }
});

test("le studio ChatGPT garde l’étape image mais évite l’étape mots-clés", () => {
  assert.equal(adsDraftHasKeywordsStep({ provider: "openai" }), false);
  assert.equal(adsDraftHasMediaStep({ provider: "openai", campaignType: "generic" }), true);
});

test("le studio reflète les formats image et le budget quotidien documentés par ChatGPT Ads", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const mediaServer = readFileSync(new URL("../lib/adsOpenaiMediaServer.ts", import.meta.url), "utf8");
  assert.match(client, /\["image\/jpeg", "image\/png", "image\/webp"\]/);
  assert.match(client, /image\/jpeg,image\/png,image\/webp/);
  assert.match(mediaServer, /metadata\.format !== "webp"/);
  assert.match(client, /channelId === "openai" \? "limite quotidienne" : "moyenne planifiée"/);
  assert.match(client, /limite quotidienne de campagne/);
  assert.doesNotMatch(client, /Moyenne sur 7 jours|une journée peut atteindre 2 fois|jusqu’à 2×/);
});

test("un refus HTTP 400 avant création rend le brouillon corrigeable sans autoriser un doublon", () => {
  assert.equal(openaiDraftRetrySafe({ mutationStarted: false, resources: { stage: "verified" } }), true);
  assert.equal(openaiDraftRetrySafe({ mutationStarted: true, httpStatus: 400, resources: { stage: "verified" } }), true);
  assert.equal(openaiDraftRetrySafe({ mutationStarted: true, httpStatus: 502, resources: { stage: "verified" } }), false);
  assert.equal(openaiDraftRetrySafe({ mutationStarted: true, resources: { stage: "verified" } }), false);
  assert.equal(openaiDraftRetrySafe({ mutationStarted: true, httpStatus: 400, resources: { campaignId: "cmp_1" } }), false);
});

test("une connexion ChatGPT à actualiser conserve l’identité durable sans autoriser le lancement", () => {
  const statusRoute = readFileSync(new URL("../app/api/ads/openai/status/route.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  assert.match(statusRoute, /account\?\.id \|\| integration\?\.resource_id/);
  assert.match(statusRoute, /account\?\.name \|\| integration\?\.resource_label/);
  assert.match(client, /status\.status === "needs_update" \? "needs_update" : "disconnected"/);
  assert.match(client, /status\.connected === true && accountId/);
});
