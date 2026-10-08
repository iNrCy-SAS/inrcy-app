import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { defaultMetaDeliverySettings, metaNativeDelivery } from "../lib/adsMetaCampaignSettings.ts";
import { metaAdsResourcesConsentKey, resolveMetaAdsLanguages, type MetaAdsResources } from "../lib/adsMetaResources.ts";
import { defaultOpenaiDeliverySettings, openaiNativeDelivery } from "../lib/adsOpenaiCampaignSettings.ts";
import { openaiAdsResourcesConsentKey, type OpenaiAdsResources } from "../lib/adsOpenaiResources.ts";
import { adsDestinationReviewState } from "../lib/adsDestination.ts";
import { adsIncompleteLaunchMessage, adsIncompleteLaunchSteps } from "../lib/adsLaunchReadiness.ts";
import { ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION } from "../lib/adsPublishMode.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";

type Channel = "meta" | "openai";
type Consent = { key: string; status: "active" | "paused"; metaResourcesKey?: string; openaiResourcesKey?: string };
const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name: string, scope: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); }; visit(source);
  assert.ok(declaration, `${name} must exist`);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}
const metaAccountId = "1234567890", openaiAccountId = "adacct_native_test", pageId = "9876543210";
function campaign(channel: Channel, creationMode: "manual" | "inrcy" = "inrcy") {
  const accountId = channel === "meta" ? metaAccountId : openaiAccountId;
  const budget = { type: "total" as const, totalEuros: 200, startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), endAt: new Date(Date.now() + 8 * 86_400_000).toISOString() };
  const metaDeliverySettings = { ...defaultMetaDeliverySettings(), budget };
  const openaiDeliverySettings = { ...defaultOpenaiDeliverySettings(), budget };
  const parsed = parseAdsCampaignInput({
    provider: channel, creationMode, campaignType: channel === "meta" ? "meta_traffic" : "generic", objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", adAccountId: accountId, accountCurrency: "EUR", name: "Découvrir iNrCy", bidStrategy: channel === "meta" ? "maximize_clicks" : "manual_review", dailyBudgetEuros: 25, endDate: budget.endAt.slice(0, 10), destinationUrl: "https://example.com/offre", trackingParameters: `utm_source=${channel}&utm_campaign=inrcy`,
    headlines: ["Découvrez iNrCy"], primaryText: "Un outil pour simplifier votre activité professionnelle.", descriptions: channel === "meta" ? [] : ["Un outil pour simplifier votre activité professionnelle."], keywords: [], negativeKeywords: [], targetLocations: ["Hauts-de-France"], languages: channel === "meta" ? ["6"] : ["fr"], creativeType: "image", mediaStrategy: "image", creativeUrl: "https://cdn.example.fr/annonce.png", imageUrl: "https://cdn.example.fr/annonce.png", creativeLibraryId: "998e76ef-09fc-426a-a55e-24323d248809",
    ...(channel === "meta" ? { pageId, callToAction: "En savoir plus", noSpecialCategoryConfirmed: true, metaPlacements: ["facebook_feed"], metaCreativeAssets: { feedImageUrl: "https://cdn.example.fr/annonce.png", storyReelImageUrl: "" }, metaDeliverySettings, metaGeoTargets: [{ key: "native-hdf", type: "region", name: "Hauts-de-France", countryCode: "FR" }] } : { callToAction: "", openaiDeliverySettings, openaiBidEuros: 1.5 }),
  }, { purpose: "publish" });
  assert.ok(parsed.draft, parsed.error || "native fixture must be valid"); return parsed.draft;
}
function metaResources(): MetaAdsResources { return { selectedAccountId: metaAccountId, selectedPageId: pageId, account: { id: metaAccountId, name: "Compte iNrCy", currency: "EUR", status: 1, timezone: "Europe/Paris" }, pages: [{ id: pageId, name: "Page iNrCy", instagramUserId: "1122334455" }], instagramAccountIds: ["1122334455"], locales: [{ id: "6", name: "Français" }, { id: "24", name: "Anglais" }] }; }
function openaiResources(): OpenaiAdsResources { return { selectedAccountId: openaiAccountId, account: { id: openaiAccountId, name: "Compte iNrCy", currencyCode: "EUR", timezone: "Europe/Paris", status: "active", brandReviewStatus: "approved", accountReviewStatus: "approved" }, geographyOptions: [{ id: "native-hdf", name: "Hauts-de-France", canonicalName: "Hauts-de-France, France", countryCode: "FR", type: "region" }], verifiedAt: new Date().toISOString() }; }
function launchHarness(channel: Channel, options: {
  creationMode?: "manual" | "inrcy"; legacy?: boolean; confirmedSpend?: boolean; destinationConfirmed?: boolean; destinationValid?: boolean; locations?: string[];
  accountId?: string; pageId?: string; resourcesAccountId?: string; changedResources?: boolean;
  launchStatus?: "active" | "paused"; consentStatus?: "active" | "paused";
  editDuring?: "accounts" | "resources" | "save"; revokeConsentDuringPreflight?: boolean;
  publisherReady?: boolean; publisherLocationCount?: number; publisherLanguageCount?: number; publisherPageId?: string; publisherResourcesKey?: string;
} = {}) {
  const accountId = channel === "meta" ? metaAccountId : openaiAccountId;
  const draft = campaign(channel, options.creationMode);
  if (options.legacy) { delete draft.metaDeliverySettings; delete draft.metaGeoTargets; delete draft.openaiDeliverySettings; draft.trackingParameters = ""; }
  if (options.locations) draft.targetLocations = options.locations;
  let stateDraft = draft, dirty = true, savedId: string | null = null, confirmedSpend = options.confirmedSpend === true;
  const meta = metaResources(), openai = openaiResources();
  const resourcesKey = channel === "meta" ? metaAdsResourcesConsentKey(meta) : openaiAdsResourcesConsentKey(openai)!;
  const launchStatus = options.launchStatus || "active";
  const consent: { current: Consent | null } = { current: confirmedSpend ? { key: JSON.stringify(draft), status: options.consentStatus || launchStatus, ...(channel === "meta" ? { metaResourcesKey: resourcesKey } : { openaiResourcesKey: resourcesKey }) } : null };
  const dialogs: Array<{ mode: string; launchStatus?: string; details?: Record<string, unknown> }> = [], notices: string[] = [], requests: Array<{ url: string; method: string; body?: string }> = [];
  const noop = () => {};
  const edit = () => { stateDraft = { ...stateDraft, headlines: ["Une modification à conserver"] }; dirty = true; confirmedSpend = false; consent.current = null; };
  const scope: Record<string, unknown> = {
    channelId: channel, provider: channel, channelMeta: { label: channel === "meta" ? "Meta Ads" : "ChatGPT Ads" }, draft, channelPublishingEnabled: true, isAdsDraftAccountChannel: () => true,
    busy: null, demoSubmissionRef: { current: false }, demoDialog: null, creating: true, creationPath: options.creationMode === "manual" ? "manual" : "inrcy", step: options.creationMode === "manual" ? 9 : 10, validationStep: options.creationMode === "manual" ? 9 : 10,
    destinationReview: { required: true, valid: options.destinationValid !== false, confirmed: options.destinationConfirmed !== false }, confirmedSpend, linkedInLaunchConsent: consent,
    effectiveMetaResources: meta, effectiveOpenaiResources: openai, metaAdsResourcesConsentKey, openaiAdsResourcesConsentKey, metaNativeDelivery, openaiNativeDelivery, resolveMetaAdsLanguages,
    ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION, unsupportedAdsConnectorReason: () => null, liveFormatAvailable: true, livePublisherConversionReady: true, metaLivePlacementsSupported: true, livePublisherMediaReady: true, metaPlacementsNeedInstagramIdentity: () => false,
    openaiLiveReady: launchStatus === "active", openaiAccountReady: true, openaiReadinessMessage: "", openaiLiveReadinessMessage: "",
    setNotice: (value: string) => notices.push(value), setBusy: noop, setPublicationPhase: noop, setConnected: noop, setConnectionStatus: noop, setConnectionSnapshots: noop, setAccounts: noop, setPages: noop, setConfiguredAccountId: noop, setConfiguredAccountLabel: noop, setConfiguredPageId: noop, setMetaResources: noop, setMetaResourcesLoad: noop, setOpenaiAccountReady: noop, setOpenaiLiveReady: noop, setOpenaiReadinessMessage: noop, setOpenaiLiveReadinessMessage: noop,
    setConfirmedSpend: (value: boolean) => { confirmedSpend = value; }, setDraft: (next: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { stateDraft = typeof next === "function" ? next(stateDraft) : next; }, setDirty: (value: boolean) => { dirty = value; }, savedId, setSavedId: (value: string) => { savedId = value; }, setDemoDialog: (dialog: typeof dialogs[number] | null) => { if (dialog) dialogs.push(dialog); }, parseAdsCampaignInput,
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      requests.push({ url, method: init?.method || "GET", body: init?.body });
      if (url === "/api/ads/accounts?provider=meta" || url === "/api/ads/openai/status") {
        if (options.editDuring === "accounts") edit();
        return channel === "meta" ? { connected: true, selectedAccountId: options.accountId || accountId, selectedPageId: options.pageId || pageId, selectedAccountLabel: "Compte iNrCy", accounts: [{ id: options.accountId || accountId, name: "Compte iNrCy", currency: "EUR" }], pages: [{ id: options.pageId || pageId, name: "Page iNrCy", instagramUserId: "1122334455" }] } : { connected: true, accountId: options.accountId || accountId, accountName: "Compte iNrCy", pausedCreationEnabled: true, liveDeliveryEnabled: launchStatus === "active" };
      }
      if (url === "/api/ads/meta/resources" || url.startsWith("/api/ads/openai/resources?accountId=")) {
        if (options.editDuring === "resources") edit();
        const selectedAccountId = options.resourcesAccountId || accountId;
        return channel === "meta" ? { ...meta, selectedAccountId, account: { ...meta.account, id: selectedAccountId, ...(options.changedResources ? { timezone: "UTC" } : {}) } } : { ...openai, selectedAccountId, account: { ...openai.account, id: selectedAccountId, ...(options.changedResources ? { accountReviewStatus: "pending" } : {}) } };
      }
      if (url === "/api/ads/campaigns") { assert.equal(init?.method, "POST"); if (options.editDuring === "save") edit(); return { campaign: { id: `saved-${channel}-draft` } }; }
      if (url === `/api/ads/campaigns/saved-${channel}-draft/preflight?mode=${launchStatus === "active" ? "live" : "paused"}`) {
        assert.equal(init?.method, undefined, "saved preflight must remain read-only");
        if (options.revokeConsentDuringPreflight) { consent.current = null; confirmedSpend = false; }
        return { ready: options.publisherReady !== false, selectedAccountId: accountId, verifiedLocationCount: options.publisherLocationCount ?? 1, resourcesKey: options.publisherResourcesKey ?? (channel === "meta" && options.legacy ? "" : resourcesKey), ...(channel === "meta" ? { selectedPageId: options.publisherPageId || pageId, verifiedLanguageCount: options.publisherLanguageCount ?? (options.legacy ? 0 : 1) } : {}) };
      }
      assert.equal(url, `/api/ads/campaigns/saved-${channel}-draft/publish`, "no other provider may be contacted"); assert.equal(init?.method, "POST");
      return { campaign: { status: launchStatus } };
    }, readJson: async (value: unknown) => value,
  };
  scope.confirmCampaignLaunch = actualFunction("confirmCampaignLaunch", scope);
  return { open: actualFunction("openLaunchDialog", scope), requests, dialogs, notices, consent, resourcesKey,
    draft: () => stateDraft, dirty: () => dirty, spend: () => confirmedSpend,
    manualConfirm: () => actualFunction("confirmCampaignLaunch", { ...scope, draft: stateDraft, savedId, confirmedSpend: true, demoDialog: dialogs.at(-1) })(),
  };
}

for (const channel of ["meta", "openai"] as const) {
  test(`${channel} IA requires budget and destination consent before any account lookup`, async () => {
    for (const options of [{}, { confirmedSpend: true, destinationConfirmed: false }, { confirmedSpend: true, destinationValid: false }]) {
      const h = launchHarness(channel, options); await h.open(true); assert.deepEqual(h.requests, []); assert.deepEqual(h.dialogs, []);
    }
  });
  test(`${channel} approval covers the exact copy, media, URL, native budget and targeting`, async () => {
    for (const patch of [{ headlines: ["Une autre promesse"] }, { creativeUrl: "https://cdn.example.fr/autre.png" }, { destinationUrl: "https://example.com/autre" }, { trackingParameters: "utm_campaign=autre" }, channel === "meta" ? { metaGeoTargets: [] } : { openaiDeliverySettings: defaultOpenaiDeliverySettings() }]) {
      const h = launchHarness(channel, { confirmedSpend: true }); h.consent.current!.key = JSON.stringify({ ...h.draft(), ...patch }); await h.open(true); assert.deepEqual(h.requests, []); assert.deepEqual(h.dialogs, []);
    }
  });
  test(`${channel} rejects changed identity or native account metadata before saving`, async () => {
    for (const options of [{ accountId: "2233445566" }, { resourcesAccountId: "2233445566" }, { changedResources: true }, ...(channel === "meta" ? [{ pageId: "2233445566" }] : [])]) {
      const h = launchHarness(channel, { confirmedSpend: true, ...options }); await h.open(true); assert.equal(h.requests.some(({ method }) => method === "POST"), false); assert.deepEqual(h.dialogs, []);
    }
  });
  test(`${channel} stable IA checks native resources, saves once, preflights then publishes without another dialog`, async () => {
    const h = launchHarness(channel, { confirmedSpend: true }); const expected = h.draft(); await h.open(true);
    assert.deepEqual(h.requests.map(({ url, method }) => `${method} ${url}`), [
      channel === "meta" ? "GET /api/ads/accounts?provider=meta" : "GET /api/ads/openai/status",
      channel === "meta" ? "GET /api/ads/meta/resources" : `GET /api/ads/openai/resources?accountId=${h.draft().adAccountId}`,
      "POST /api/ads/campaigns", `GET /api/ads/campaigns/saved-${channel}-draft/preflight?mode=live`, `POST /api/ads/campaigns/saved-${channel}-draft/publish`,
    ], h.notices.join(" "));
    const saved = JSON.parse(h.requests.find(({ url }) => url === "/api/ads/campaigns")?.body || "{}");
    assert.deepEqual(saved, JSON.parse(JSON.stringify(expected))); assert.equal(saved.dailyBudgetEuros, 25); assert.equal((saved.metaDeliverySettings || saved.openaiDeliverySettings).budget.totalEuros, 200);
    assert.deepEqual(JSON.parse(h.requests.at(-1)?.body || "{}"), { mode: "live", confirmation: ADS_LIVE_PUBLISH_CONFIRMATION, ...(channel === "openai" ? { billingConfirmed: true } : {}) });
    assert.equal(h.dialogs.length, 1); assert.equal(h.dialogs[0].mode, "success"); assert.equal(h.spend(), false); assert.equal(h.consent.current, null);
  });
  test(`${channel} edits during lookups or saving remain local and abort publication`, async () => {
    for (const editDuring of ["accounts", "resources", "save"] as const) {
      const h = launchHarness(channel, { confirmedSpend: true, editDuring }); await h.open(true);
      assert.equal(h.requests.filter(({ method }) => method === "POST").length, editDuring === "save" ? 1 : 0); assert.equal(h.requests.some(({ url }) => url.endsWith("/publish")), false);
      assert.equal(h.draft().headlines[0], "Une modification à conserver"); assert.equal(h.dirty(), true); assert.deepEqual(h.dialogs, []);
    }
  });
  test(`${channel} refuses missing saved preflight proofs and consent revoked during that check`, async () => {
    for (const options of [{ publisherReady: false }, { publisherLocationCount: 0 }, { publisherLocationCount: 2 }, { publisherResourcesKey: "stale-resource-proof" }, { revokeConsentDuringPreflight: true }, ...(channel === "meta" ? [{ publisherPageId: "2233445566" }, { publisherLanguageCount: 0 }] : [])]) {
      const h = launchHarness(channel, { confirmedSpend: true, ...options }); await h.open(true); assert.equal(h.requests.some(({ url }) => url.endsWith("/publish")), false); assert.deepEqual(h.dialogs, []);
    }
  });
  test(`${channel} manual retains its confirmation dialog and its native total budget`, async () => {
    const h = launchHarness(channel, { creationMode: "manual" }); await h.open();
    assert.equal(h.requests.some(({ method }) => method === "POST"), false); assert.equal(h.dialogs.length, 1); assert.equal(h.dialogs[0].mode, "confirm");
    const budget = h.dialogs[0].details!.nativeBudget as { type: string; totalEuros: number }; assert.equal(budget.type, "total"); assert.equal(budget.totalEuros, 200);
    await h.manualConfirm(); assert.equal(h.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 1); assert.equal(h.requests.filter(({ url }) => url.endsWith("/publish")).length, 1); assert.equal(h.dialogs.at(-1)?.mode, "success");
  });
  test(`${channel} historical manual draft without native settings keeps its daily confirmation and save flow`, async () => {
    const h = launchHarness(channel, { creationMode: "manual", legacy: true }); await h.open();
    assert.equal(h.requests.some(({ method }) => method === "POST"), false); assert.equal(h.dialogs[0]?.mode, "confirm");
    const budget = h.dialogs[0].details!.nativeBudget as { type: string; totalEuros: number | null }; assert.equal(budget.type, "daily"); assert.equal(budget.totalEuros, null);
    await h.manualConfirm(); assert.equal(h.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 1); assert.equal(h.requests.filter(({ url }) => url.endsWith("/publish")).length, 1); assert.equal(h.dialogs.at(-1)?.mode, "success");
  });
}

test("ChatGPT supports an approved paused creation without billing consent or an active launch", async () => {
  const h = launchHarness("openai", { confirmedSpend: true, launchStatus: "paused" }); await h.open(true);
  assert.deepEqual(JSON.parse(h.requests.at(-1)?.body || "{}"), { mode: "paused", confirmation: ADS_PAUSED_PUBLISH_CONFIRMATION });
  assert.equal(h.dialogs.at(-1)?.mode, "success"); assert.equal(h.dialogs.at(-1)?.launchStatus, "paused");
});

test("ChatGPT never substitutes an active approval with a newly paused launch", async () => {
  const h = launchHarness("openai", { confirmedSpend: true, launchStatus: "paused", consentStatus: "active" }); await h.open(true);
  assert.equal(h.requests.some(({ method }) => method === "POST"), false); assert.deepEqual(h.dialogs, []);
  assert.equal(h.spend(), false); assert.equal(h.consent.current, null);
});

function findAll(predicate: (node: ts.Node) => boolean, root: ts.Node = source): ts.Node[] {
  const result: ts.Node[] = []; const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(root); return result;
}
function evaluate(node: ts.Node, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`const value = (${node.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn value;`)(...Object.values(scope));
}
function initializer(name: string, scope: Record<string, unknown>) {
  const node = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0] as ts.VariableDeclaration | undefined;
  assert.ok(node?.initializer, `${name} must exist`); return evaluate(node.initializer, scope);
}
function label(marker: string) {
  const labels = findAll((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "label" && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === marker));
  assert.equal(labels.length, 1); return labels[0];
}
function field(name: string, root: ts.Node) {
  const attribute = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(source) === name, root)[0] as ts.JsxAttribute | undefined;
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression); return attribute.initializer.expression;
}
function confirmationHarness(channel: Channel) {
  let draft = { ...campaign(channel), ...(channel === "meta" ? { noSpecialCategoryConfirmed: false } : {}) }, spend = false, url = "", dirty = false;
  const meta = metaResources(), openai = openaiResources(); const consent: { current: Consent | null } = { current: null };
  const scope = () => {
    const destinationReview = adsDestinationReviewState({ assisted: true, fieldVisible: true, websiteRequired: true, destinationUrl: draft.destinationUrl, confirmedUrl: url });
    const base: Record<string, unknown> = {
      channelId: channel, creationPath: "inrcy", draft, busy: null, reviewAccountReady: true,
      effectiveMetaResources: meta, effectiveOpenaiResources: openai, effectiveGoogleResources: null, metaResourcesLoad: "ready", openaiResourcesLoad: "ready", openaiLiveReady: true, openaiAccountReady: true,
      googleLaunchReadinessReason: "", linkedInLaunchReadinessReason: "", pinterestLaunchReadinessReason: "", metaLaunchReadinessReason: "", openaiLaunchReadinessReason: "", launchUnavailableReason: "",
      destinationReview, adsIncompleteLaunchSteps, adsIncompleteLaunchMessage, foundationsStep: 2, geographyStep: channel === "meta" ? 3 : 4, targetingStep: channel === "meta" ? 4 : 5, biddingStep: channel === "meta" ? 5 : 6, creativeStep: channel === "meta" ? 6 : 7, mediaStep: channel === "meta" ? 7 : 8, deliveryStep: channel === "meta" ? 8 : 9, budgetStep: channel === "meta" ? 9 : 3, validationStep: 10, keywordsStep: -1,
      livePublisherMediaReady: true, linkedInLaunchConsent: consent, confirmedSpend: spend, metaAdsResourcesConsentKey, openaiAdsResourcesConsentKey,
      setDraft: (next: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { draft = typeof next === "function" ? next(draft) : next; }, setDirty: (value: boolean) => { dirty = value; }, setConfirmedSpend: (value: boolean) => { spend = value; }, setConfirmedDestinationUrl: (value: string) => { url = value; }, applyDraftEdit: actualFunction("applyDraftEdit", {}),
    };
    base.updateDraft = (next: Partial<AdsCampaignInput>) => actualFunction("updateDraft", scope())(next); base.confirmReviewedDeclaration = actualFunction("confirmReviewedDeclaration", base);
    base.incompleteLaunchSteps = initializer("incompleteLaunchSteps", base); base.incompleteLaunchMessage = initializer("incompleteLaunchMessage", base); base.launchBlockingMessage = initializer("launchBlockingMessage", base); base.launchBlocked = initializer("launchBlocked", base); return base;
  };
  const button = findAll((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "button" && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "onClick" && attribute.getText(source).includes("openLaunchDialog(")))[0]; assert.ok(button);
  return { consent, draft: () => draft, spend: () => spend, dirty: () => dirty,
    budgetDisabled: (patch: Record<string, unknown> = {}) => evaluate(field("disabled", label(`data-${channel}-launch-confirmation`)), { ...scope(), ...patch }), launchDisabled: () => evaluate(field("disabled", button), scope()),
    budget: (checked: boolean) => evaluate(field("onChange", label(`data-${channel}-launch-confirmation`)), scope())({ target: { checked } }), destination: (checked: boolean) => evaluate(field("onChange", label(`data-${channel}-destination-confirmation`)), scope())({ target: { checked } }),
    declaration: (checked: boolean) => actualFunction("confirmReviewedDeclaration", scope())("noSpecialCategoryConfirmed", checked), edit: (patch: Partial<AdsCampaignInput>) => actualFunction("updateDraft", scope())(patch),
  };
}

test("Meta budget, special-category declaration and destination are independent; VALIDER alone waits for all", () => {
  for (const order of [["budget", "declaration", "destination"], ["destination", "declaration", "budget"], ["declaration", "budget", "destination"]] as const) {
    const h = confirmationHarness("meta"); assert.equal(h.budgetDisabled(), false); assert.equal(h.launchDisabled(), true);
    for (const [index, confirmation] of order.entries()) { h[confirmation](true); assert.equal(h.launchDisabled(), index < order.length - 1); if (h.spend()) assert.equal(h.consent.current?.key, JSON.stringify(h.draft())); }
    const key = h.consent.current!.metaResourcesKey; h.declaration(false); assert.equal(h.launchDisabled(), true); assert.equal(h.spend(), true); assert.equal(h.consent.current?.key, JSON.stringify(h.draft())); assert.equal(h.consent.current?.metaResourcesKey, key);
    h.declaration(true); h.destination(false); assert.equal(h.launchDisabled(), true); assert.equal(h.spend(), true); h.destination(true); assert.equal(h.launchDisabled(), false);
  }
});

test("ChatGPT budget and destination can be confirmed in either order without a fictitious legal declaration", () => {
  for (const order of [["budget", "destination"], ["destination", "budget"]] as const) {
    const h = confirmationHarness("openai"); assert.equal(h.budgetDisabled(), false); assert.equal(h.launchDisabled(), true);
    for (const [index, confirmation] of order.entries()) { h[confirmation](true); assert.equal(h.launchDisabled(), index < order.length - 1); if (h.spend()) assert.equal(h.consent.current?.key, JSON.stringify(h.draft())); }
    h.destination(false); assert.equal(h.launchDisabled(), true); assert.equal(h.spend(), true); h.destination(true); assert.equal(h.launchDisabled(), false);
  }
});

test("Both final budget checkboxes require fresh technical readiness even though confirmations have free order", () => {
  for (const channel of ["meta", "openai"] as const) {
    const h = confirmationHarness(channel); assert.equal(h.budgetDisabled(), false);
    for (const patch of [{ busy: "demo" }, { reviewAccountReady: false }, channel === "meta" ? { metaResourcesLoad: "loading" } : { openaiResourcesLoad: "loading" }, channel === "meta" ? { effectiveMetaResources: null } : { effectiveOpenaiResources: null }, channel === "meta" ? { metaLaunchReadinessReason: "Zone à vérifier" } : { openaiLaunchReadinessReason: "Zone à vérifier" }]) assert.equal(h.budgetDisabled(patch), true);
  }
});

test("Changing real copy, geography, URL, native budget or platforms revokes the exact approval", () => {
  for (const channel of ["meta", "openai"] as const) for (const patch of [{ headlines: ["Nouvelle promesse"] }, { destinationUrl: "https://example.com/autre" }, { targetLocations: ["Paris"] }, { dailyBudgetEuros: 50 }, channel === "meta" ? { metaDeliverySettings: defaultMetaDeliverySettings() } : { openaiDeliverySettings: { ...defaultOpenaiDeliverySettings(), platforms: ["ios_app" as const] } }]) {
    const h = confirmationHarness(channel); h.budget(true); if (channel === "meta") h.declaration(true); h.destination(true); assert.equal(h.launchDisabled(), false);
    h.edit(patch); assert.equal(h.spend(), false); assert.equal(h.consent.current, null); assert.equal(h.launchDisabled(), true); assert.equal(h.dirty(), true);
  }
});


test("Meta historical assisted draft accepts only the legacy empty provider key and zero language count after fresh resource approval", async () => {
  const h = launchHarness("meta", { confirmedSpend: true, legacy: true });
  const expected = h.draft();
  await h.open(true);
  assert.equal(h.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 1);
  assert.equal(h.requests.filter(({ url }) => url.endsWith("/publish")).length, 1, h.notices.join(" "));
  assert.equal(h.dialogs.at(-1)?.mode, "success");
  const saved = JSON.parse(h.requests.find(({ url }) => url === "/api/ads/campaigns")!.body!);
  assert.deepEqual(saved, JSON.parse(JSON.stringify(expected)));
  assert.equal("metaDeliverySettings" in saved, false);
  assert.equal("metaGeoTargets" in saved, false);
  const budget = h.dialogs.at(-1)!.details!.nativeBudget as { type: string; totalEuros: number | null };
  assert.equal(budget.type, "daily"); assert.equal(budget.totalEuros, null);
});

test("Meta historical assisted approval still refuses changed native resources and incorrect legacy proof counts", async () => {
  const changed = launchHarness("meta", { confirmedSpend: true, legacy: true, changedResources: true });
  await changed.open(true); assert.equal(changed.requests.some(({ method }) => method === "POST"), false);
  for (const options of [{ publisherResourcesKey: "nonempty-unexpected-proof" }, { publisherLanguageCount: 1 }, { publisherLocationCount: 0 }, { publisherLocationCount: 2 }, { publisherPageId: "2233445566" }]) {
    const h = launchHarness("meta", { confirmedSpend: true, legacy: true, ...options });
    await h.open(true); assert.equal(h.requests.some(({ url }) => url.endsWith("/publish")), false); assert.deepEqual(h.dialogs, []);
  }
});

test("Native Meta cannot reuse the legacy empty key or zero-language preflight exception", async () => {
  for (const options of [{ publisherResourcesKey: "" }, { publisherLanguageCount: 0 }, { publisherResourcesKey: "", publisherLanguageCount: 0 }]) {
    const h = launchHarness("meta", { confirmedSpend: true, ...options });
    await h.open(true); assert.equal(h.requests.some(({ url }) => url.endsWith("/publish")), false); assert.deepEqual(h.dialogs, []);
  }
});

test("ChatGPT verifies each requested label while accepting aliases deduplicated to one native location", async () => {
  const locations = ["Hauts-de-France", "Hauts-de-France, France"];
  const accepted = launchHarness("openai", { confirmedSpend: true, locations, publisherLocationCount: 1 });
  await accepted.open(true); assert.equal(accepted.requests.filter(({ url }) => url.endsWith("/publish")).length, 1, accepted.notices.join(" "));
  const saved = JSON.parse(accepted.requests.find(({ url }) => url === "/api/ads/campaigns")!.body!);
  assert.deepEqual(saved.targetLocations, locations);
  for (const publisherLocationCount of [0, -1, 1.5, 3]) {
    const blocked = launchHarness("openai", { confirmedSpend: true, locations, publisherLocationCount });
    await blocked.open(true); assert.equal(blocked.requests.some(({ url }) => url.endsWith("/publish")), false);
  }
});
