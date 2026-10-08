import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

import { parseAdsCampaignInput } from "../../lib/adsValidation.ts";
import { defaultPinterestDeliverySettings, pinterestNativeDelivery } from "../../lib/adsPinterestCampaignSettings.ts";
import { buildPinterestLiveAdGroupBody } from "../../lib/adsPinterestPublish.ts";

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

test("TikTok draft accounts require valid local identifiers and never permit publication", () => {
  for (const adAccountId of ["12345", "123456789012", "1".repeat(25), "1".repeat(30)]) {
    const input = campaign("tiktok", adAccountId);
    delete (input as { channelSettings?: unknown }).channelSettings;
    const parsed = parseAdsCampaignInput(input, { purpose: "draft" });
    assert.equal(parsed.error, null);
    assert.equal(parsed.draft?.adAccountId, adAccountId);
    const publication = parseAdsCampaignInput(input, { purpose: "publish" });
    assert.equal(publication.draft, null);
    assert.match(publication.error || "", /connexion et la publication.*pas encore disponibles/);
  }
  for (const adAccountId of ["1234", "1".repeat(31), "account_123456", "https://example.com/123456", "123%456"]) {
    const input = campaign("tiktok", adAccountId);
    delete (input as { channelSettings?: unknown }).channelSettings;
    assert.equal(parseAdsCampaignInput(input, { purpose: "draft" }).draft, null);
    assert.match(parseAdsCampaignInput(input, { purpose: "draft" }).error || "", /identifiant du compte publicitaire est invalide/);
  }
});

test("X accepts its connected advertiser in a draft but still refuses publication", () => {
  const input = campaign("x", "ab12cd");
  delete (input as { channelSettings?: unknown }).channelSettings;
  const draft = parseAdsCampaignInput(input, { purpose: "draft" });
  assert.equal(draft.error, null);
  assert.equal(draft.draft?.adAccountId, "ab12cd");
  const publication = parseAdsCampaignInput(input, { purpose: "publish" });
  assert.equal(publication.draft, null);
  assert.ok(publication.error);
});

test("Pinterest preserves draft alternatives but requires an explicit single title before publishing", () => {
  const input = { ...campaign("pinterest", "123456789012"), headlines: ["Préparez votre projet", "Découvrez notre service"] };
  assert.deepEqual(parseAdsCampaignInput(input, { purpose: "draft" }).draft?.headlines, input.headlines);
  const published = parseAdsCampaignInput(input, { purpose: "publish" });
  assert.equal(published.draft, null);
  assert.match(published.error || "", /un seul titre/);
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
  assert.match(client, /<CampaignMediaPreview key=/);
  assert.match(css, /\.studioDedicatedMediaCard \.campaignMediaPreview\{[^}]*height:clamp\(/);
  assert.match(css, /\.studioDedicatedMediaCard \.campaignMediaPreviewImage[^}]*object-fit:contain/);
  assert.match(css, /\.studioDedicatedMediaCard \.campaignMediaPreview video\{[^}]*object-fit:contain/);
});

test("saving a Pinterest proposal stays local and defers live advertiser checks to publication", () => {
  const route = readFileSync(path.join(root, "app/api/ads/campaigns/route.ts"), "utf8");
  const publishRoute = readFileSync(path.join(root, "app/api/ads/campaigns/[id]/publish/route.ts"), "utf8");
  assert.doesNotMatch(route, /readPinterestAdsIntegration|listPinterestAdsAccounts|listAdsAccounts|listMetaPages|listLinkedInAdsAccounts/);
  assert.match(route, /Saving is deliberately local/);
  assert.match(route, /draft\.provider === "pinterest"/);
  assert.match(publishRoute, /readPinterestAdsIntegration|listPinterestAdsAccounts/);
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
  const source = ts.createSourceFile("AdsClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findHandler = (node: ts.Node): ts.FunctionDeclaration | undefined => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "openLaunchDialog") return node;
    return ts.forEachChild(node, findHandler);
  };
  const handler = findHandler(source);
  assert.ok(handler);
  assert.match(handler.getText(source), /let launchStatus: AdsCampaignLaunchStatus = "active"/);
  const findGuard = (node: ts.Node): ts.IfStatement | undefined => {
    if (ts.isIfStatement(node) && ts.isExpressionStatement(node.thenStatement)
      && ts.isBinaryExpression(node.thenStatement.expression)
      && node.thenStatement.expression.left.getText(source) === "launchStatus"
      && node.thenStatement.expression.right.getText(source) === '"paused"') return node;
    return ts.forEachChild(node, findGuard);
  };
  const pausedGuard = findGuard(handler);
  assert.ok(pausedGuard, "the final handler must preserve a safe PAUSED alternative");
  const chooseStatus = new Function("preflight", "connection", "group", `let launchStatus = "active"; ${pausedGuard.getText(source)}; return launchStatus;`);
  for (const canServeCampaigns of [true, false, undefined]) {
    for (const status of ["ACTIVE", "DRAFT", "PAUSED"]) {
      assert.equal(chooseStatus(
        { account: { canServeCampaigns } },
        { selectedAccountCanServe: canServeCampaigns !== true },
        { status },
      ), canServeCampaigns === true && status === "ACTIVE" ? "active" : "paused",
      `the fresh resource response controls ${status}, never the older account response`);
    }
  }
  assert.match(handler.getText(source), /const confirmation: DemoDialogState = \{\s*mode: "confirm",\s*channelId,\s*pageId,\s*launchStatus,/);
  assert.match(handler.getText(source), /setDemoDialog\(confirmation\)/);
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
  assert.match(contract, /auto_targeting_enabled: true/);
  assert.match(contract, /is_removable: true/);
  assert.ok(contract.indexOf('path: `${accountPath}/ads`') < contract.indexOf('path: `${accountPath}/campaigns`'));
  assert.match(publisher, /for \(const step of buildPinterestActivationSteps/);
  assert.match(publisher, /matchPinterestGeographies\(draft\.targetLocations, native\.locationPayload, native\.geoPayload\)/);
  assert.match(publisher, /LOCALE: matchPinterestTargetLanguages\(draft\.languages, native\.localePayload\)/);
  const targetingIndex = publisher.indexOf("targetingSpec =");
  const createIndex = publisher.indexOf("const campaignId = batchCreatedId");
  assert.ok(targetingIndex >= 0 && createIndex > targetingIndex, "native targeting is verified before the first campaign creation");
  assert.match(route, /pinterestAccountCountry = selectedAccount\.country/);
  assert.match(route, /accountCountry: pinterestAccountCountry/);
  assert.match(route, /PinterestAdsPublishError/);
  assert.match(route, /Pinterest Ads Manager/);
  assert.match(migration, /'meta'::text, 'google'::text, 'pinterest'::text/);
});

test("Pinterest keeps legacy MAX_BID1 and sends native AUTOMATIC_BID without a manual amount", () => {
  const parsed = parseAdsCampaignInput(campaign("pinterest", "123456789012"), { purpose: "publish" });
  assert.ok(parsed.draft, parsed.error || "the historical image campaign must remain publishable");
  assert.equal(parsed.draft.pinterestDeliverySettings, undefined);
  const legacy = pinterestNativeDelivery(parsed.draft);
  assert.equal(legacy.bidStrategyType, "MAX_BID");
  assert.equal(legacy.bidInMicroCurrency, 1_000_000);
  const group = {
    name: "Groupe", campaignId: "123456", objectiveType: "CONSIDERATION" as const,
    targetingSpec: { LOCATION: ["FR"], LOCALE: ["fr"] },
  };
  const historical = buildPinterestLiveAdGroupBody({ ...group, bidInMicroCurrency: legacy.bidInMicroCurrency });
  assert.equal(historical.bid_strategy_type, "MAX_BID");
  assert.equal(historical.bid_in_micro_currency, 1_000_000);
  const native = pinterestNativeDelivery({ ...parsed.draft, pinterestDeliverySettings: defaultPinterestDeliverySettings(), pinterestBidEuros: 999 });
  assert.equal(native.bidStrategyType, "AUTOMATIC_BID");
  assert.equal(native.bidInMicroCurrency, null);
  const automatic = buildPinterestLiveAdGroupBody({ ...group, bidStrategyType: native.bidStrategyType, bidInMicroCurrency: native.bidInMicroCurrency });
  assert.equal(automatic.bid_strategy_type, "AUTOMATIC_BID");
  assert.equal("bid_in_micro_currency" in automatic, false, "automatic delivery must not inherit a historical manual bid");
  for (const body of [historical, automatic]) {
    assert.equal(body.status, "PAUSED");
    assert.equal(body.auto_targeting_enabled, true);
    assert.equal(body.billable_event, "CLICKTHROUGH");
    assert.deepEqual(body.targeting_spec, group.targetingSpec);
  }
  assert.throws(() => buildPinterestLiveAdGroupBody({ ...group, bidStrategyType: "AUTOMATIC_BID", bidInMicroCurrency: 1_000_000 }), /montant.*stratégie/);
  assert.throws(() => buildPinterestLiveAdGroupBody({ ...group, bidStrategyType: "MAX_BID", bidInMicroCurrency: null }), /montant.*stratégie/);
});
