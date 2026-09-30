import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseAdsCampaignInput } from "../../lib/adsValidation.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);

function campaign(provider: string, adAccountId: string) {
  return {
    provider,
    creationMode: "manual",
    campaignType: "generic",
    objective: "website_traffic",
    conversionGoal: "website_visit",
    conversionLocation: "website",
    bidStrategy: "maximize_clicks",
    adAccountId,
    accountCurrency: "EUR",
    name: "Découverte Pinterest",
    offer: "Service local",
    dailyBudgetEuros: 20,
    endDate,
    destinationUrl: "https://example.fr/offre",
    targetLocations: ["France"],
    targetAudiences: ["Personnes préparant un projet"],
    languages: ["fr"],
    metaPlacements: [],
    primaryText: "Une idée utile à enregistrer pour votre prochain projet.",
    creativeUrl: "https://cdn.example.fr/pinterest/image.jpg",
    creativeType: "image",
    mediaStrategy: "image",
    headlines: ["Préparez votre prochain projet"],
    descriptions: [],
    keywords: [],
    negativeKeywords: [],
    channelSettings: {
      schemaVersion: 1,
      channel: "pinterest",
      objectiveType: "CONSIDERATION",
      intendedPromotionType: "STANDARD_AD",
      creativeType: "REGULAR",
      targetingMode: "automatic",
      conversionEvent: null,
    },
  };
}

test("a verified Pinterest advertiser ID can follow a local campaign proposal", () => {
  const parsed = parseAdsCampaignInput(campaign("pinterest", "123456789012"), { purpose: "draft" });
  assert.equal(parsed.error, null);
  assert.equal(parsed.draft?.adAccountId, "123456789012");
  const publishable = parseAdsCampaignInput(campaign("pinterest", "123456789012"), { purpose: "publish" });
  assert.equal(publishable.error, null);
  assert.equal(publishable.draft?.provider, "pinterest");
});

test("planned channels without the completed account binding still reject advertiser IDs", () => {
  for (const provider of ["tiktok", "x"]) {
    const input = campaign("pinterest", "123456789012");
    input.provider = provider;
    delete (input as { channelSettings?: unknown }).channelSettings;
    assert.match(parseAdsCampaignInput(input, { purpose: "draft" }).error || "", /Connectez ce canal/);
  }
});

test("the Pinterest OAuth return opens Pinterest and the proposal exposes native review steps", () => {
  const page = readFileSync(path.join(root, "app/dashboard/ads/page.tsx"), "utf8");
  const client = readFileSync(path.join(root, "app/dashboard/ads/AdsClient.tsx"), "utf8");
  assert.match(page, /isAdsChannelId\(requestedChannel\)/);
  assert.match(client, /Objectif Pinterest/);
  assert.match(client, /Audience Pinterest/);
  assert.match(client, /Découverte Pinterest/);
  assert.match(client, /Épingle sponsorisée/);
  assert.match(client, /Format du Pin/);
  assert.match(client, /Pur média/);
  assert.match(client, /pinterestFormatStep/);
  assert.match(client, /Votre média, visible en entier/);
  assert.match(client, /Destination & mesure/);
  assert.match(client, /Voir ma proposition Pinterest/);
});

test("Pinterest sépare le format du fichier média et conserve tout le cadrage", () => {
  const client = readFileSync(path.join(root, "app/dashboard/ads/AdsClient.tsx"), "utf8");
  const css = readFileSync(path.join(root, "app/dashboard/ads/ads.module.css"), "utf8");
  assert.match(client, /hidden=\{step !== pinterestFormatStep\}/);
  assert.match(client, /hidden=\{step !== mediaStep\}/);
  assert.match(client, /L’aperçu conserve son cadrage complet/);
  assert.match(css, /\.studioDedicatedMediaCard \.campaignMediaPreview\{[^}]*height:clamp\(/);
  assert.match(css, /\.studioDedicatedMediaCard \.campaignMediaPreviewImage[^}]*object-fit:contain/);
  assert.match(css, /\.studioDedicatedMediaCard \.campaignMediaPreview video\{[^}]*object-fit:contain/);
});

test("saving a Pinterest proposal revalidates the persisted advertiser server-side", () => {
  const route = readFileSync(path.join(root, "app/api/ads/campaigns/route.ts"), "utf8");
  assert.match(route, /readPinterestAdsIntegration\(user\.activeUserId\)/);
  assert.match(route, /integration\.resource_id !== draft\.adAccountId/);
  assert.match(route, /listPinterestAdsAccounts\(user\.activeUserId, integration\)/);
  assert.match(route, /draft\.provider === "pinterest"/);
});

test("Pinterest environment checks cover the dedicated Ads callback and credential pairing", () => {
  const verifier = readFileSync(path.join(root, "scripts/verify-pinterest-env.mjs"), "utf8");
  assert.match(verifier, /PINTEREST_ADS_REDIRECT_URI/);
  assert.match(verifier, /\/api\/ads\/pinterest\/callback/);
  assert.match(verifier, /Boolean\(adsClientId\) !== Boolean\(adsClientSecret\)/);
  assert.match(verifier, /ads:read/);
  assert.match(verifier, /ads:write/);
  assert.match(verifier, /pins:write/);
});

test("the final existing modal adds Active by default and Paused as the alternative", () => {
  const client = readFileSync(path.join(root, "app/dashboard/ads/AdsClient.tsx"), "utf8");
  const dialog = readFileSync(path.join(root, "app/dashboard/ads/AdsCampaignDemoDialog.tsx"), "utf8");
  assert.match(client, /let launchStatus: AdsCampaignLaunchStatus = "active"/);
  assert.match(client, /if \(connection\.selectedAccountCanServe !== true \|\| group\.status !== "ACTIVE"\) launchStatus = "paused"/);
  assert.match(client, /setDemoDialog\(\{\s*mode: "confirm",\s*channelId,\s*pageId,\s*launchStatus,/);
  assert.match(client, /"Lancer la campagne"/);
  assert.match(client, /"Enregistrer en brouillon"/);
  assert.match(dialog, /Statut au lancement/);
  assert.match(dialog, /value="active"/);
  assert.match(dialog, /value="paused"/);
  assert.match(client, /mode: paused \? "paused" : "live"/);
});

test("Pinterest publication persists the complete hierarchy and the database unlock", () => {
  const publisher = readFileSync(path.join(root, "lib/adsPinterestCampaignPublish.ts"), "utf8");
  const contract = readFileSync(path.join(root, "lib/adsPinterestPublish.ts"), "utf8");
  const route = readFileSync(path.join(root, "app/api/ads/campaigns/[id]/publish/route.ts"), "utf8");
  const migration = readFileSync(path.join(root, "supabase/migrations/20260929130000_enable_pinterest_ads_publication.sql"), "utf8");
  for (const resource of ["campaignId", "adGroupId", "pinId", "adId"]) assert.match(publisher, new RegExp(resource));
  assert.match(contract, /bid_in_micro_currency: input\.bidInMicroCurrency/);
  assert.match(contract, /bid_strategy_type: "MAX_BID"/);
  assert.match(contract, /auto_targeting_enabled: true/);
  assert.match(contract, /is_removable: true/);
  assert.ok(contract.indexOf('path: `${accountPath}/ads`') < contract.indexOf('path: `${accountPath}/campaigns`'));
  assert.match(publisher, /for \(const step of buildPinterestActivationSteps/);
  assert.match(publisher, /resolvePinterestCountryCodes\(draft\.targetLocations, options\.accountCountry\)/);
  assert.match(route, /pinterestAccountCountry = selectedAccount\.country/);
  assert.match(route, /accountCountry: pinterestAccountCountry/);
  assert.match(route, /PinterestAdsPublishError/);
  assert.match(route, /Pinterest Ads Manager/);
  assert.match(migration, /'meta'::text, 'google'::text, 'pinterest'::text/);
});
