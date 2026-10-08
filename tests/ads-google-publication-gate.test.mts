import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { defaultGoogleDeliverySettings } from "../lib/adsGoogleCampaignSettings.ts";
import { googleAdsResourcesConsentKey, type GoogleAdsAccountResources } from "../lib/adsGoogleResources.ts";
import { ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION } from "../lib/adsPublishMode.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name: string, scope: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(declaration, `${name} must exist`);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}

const accountId = "1234567890";
function campaign(creationMode: "manual" | "inrcy" = "inrcy") {
  const settings = defaultGoogleDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200 };
  settings.startDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const parsed = parseAdsCampaignInput({
    provider: "google", creationMode, campaignType: "search", objective: "website_traffic", conversionGoal: "website_visit",
    adAccountId: accountId, accountCurrency: "EUR", name: "Découvrir iNrCy", bidStrategy: "maximize_clicks",
    dailyBudgetEuros: 25, endDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10),
    destinationUrl: "https://example.com/offre", trackingParameters: "utm_source=google&utm_campaign=inrcy",
    headlines: ["Découvrez iNrCy", "Simplifiez votre activité", "Votre essai gratuit"],
    descriptions: ["Découvrez nos outils pour votre activité professionnelle.", "Essayez la solution et gérez votre activité plus simplement."],
    keywords: ["logiciel indépendants", "gestion petite entreprise"], negativeKeywords: ["emploi"],
    targetLocations: ["Hauts-de-France,France"], notEuPoliticalConfirmed: true, googleDeliverySettings: settings,
  });
  assert.ok(parsed.draft, parsed.error || "Google fixture must be valid");
  return parsed.draft;
}

function launchHarness(options: {
  creationMode?: "manual" | "inrcy";
  confirmedSpend?: boolean;
  accountId?: string;
  resourcesAccountId?: string;
  conversionsReady?: boolean;
  bidStrategy?: AdsCampaignInput["bidStrategy"];
  editDuring?: "accounts" | "resources" | "save";
  revokeConsentDuringPreflight?: boolean;
  publisherReady?: boolean;
  publisherLocationCount?: number;
  changedGoal?: boolean;
  changedTimeZone?: boolean;
} = {}) {
  const draft = { ...campaign(options.creationMode), ...(options.bidStrategy ? { bidStrategy: options.bidStrategy } : {}) };
  let stateDraft = draft;
  let dirty = true;
  let savedId: string | null = null;
  let confirmedSpend = options.confirmedSpend === true;
  const consent: { current: { key: string; status: string; googleResourcesKey?: string } | null } = { current: null };
  const dialogs: Array<{ mode: string; launchStatus?: string }> = [];
  const notices: string[] = [];
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const noop = () => {};
  const edit = () => {
    stateDraft = { ...stateDraft, headlines: ["Une modification à conserver", ...stateDraft.headlines.slice(1)] };
    dirty = true;
    confirmedSpend = false;
    consent.current = null;
  };
  const resources: GoogleAdsAccountResources = {
    selectedAccountId: options.resourcesAccountId || accountId,
    timeZone: "Europe/Paris", conversionMode: "account_defaults",
    conversionGoals: [{ category: "SIGNUP", origin: "WEBSITE", biddable: true }],
    conversionActions: [{ resourceName: `customers/${accountId}/conversionActions/7`, name: "Inscription", category: "SIGNUP", origin: "WEBSITE", type: "WEBPAGE", status: "ENABLED", primaryForGoal: true }],
    hasBiddableConversions: options.conversionsReady !== false,
  };
  consent.current = confirmedSpend ? { key: JSON.stringify(draft), status: "active", googleResourcesKey: googleAdsResourcesConsentKey(resources) } : null;
  const freshResources: GoogleAdsAccountResources = {
    ...resources,
    ...(options.changedTimeZone ? { timeZone: "Asia/Tokyo" } : {}),
    ...(options.changedGoal ? {
      conversionGoals: [{ category: "CONTACT", origin: "WEBSITE", biddable: true }],
      conversionActions: [{ resourceName: `customers/${accountId}/conversionActions/8`, name: "Demande de contact", category: "CONTACT", origin: "WEBSITE", type: "WEBPAGE", status: "ENABLED", primaryForGoal: true }],
    } : {}),
  };
  const scope: Record<string, unknown> = {
    channelId: "google", provider: "google", channelMeta: { label: "Google Ads" }, draft,
    channelPublishingEnabled: true, isAdsDraftAccountChannel: () => true,
    busy: null, demoSubmissionRef: { current: false }, demoDialog: null,
    creating: true, creationPath: options.creationMode === "manual" ? "manual" : "inrcy",
    step: options.creationMode === "manual" ? 9 : 10, validationStep: options.creationMode === "manual" ? 9 : 10,
    destinationReview: { required: true, valid: true, confirmed: true },
    confirmedSpend, linkedInLaunchConsent: consent,
    effectiveGoogleResources: resources,
    googleAdsResourcesConsentKey,
    ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION,
    unsupportedAdsConnectorReason: () => null, liveFormatAvailable: true, livePublisherConversionReady: true,
    metaLivePlacementsSupported: true, livePublisherMediaReady: true,
    setNotice: (notice: string) => notices.push(notice), setBusy: noop, setPublicationPhase: noop,
    setConfirmedSpend: (value: boolean) => { confirmedSpend = value; },
    setConnected: noop, setConnectionStatus: noop, setConnectionSnapshots: noop,
    setAccounts: noop, setPages: noop, setConfiguredAccountId: noop, setConfiguredAccountLabel: noop,
    setGoogleResources: noop, setGoogleResourcesLoad: noop, setGoogleResourcesError: noop,
    setDraft: (updater: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { stateDraft = typeof updater === "function" ? updater(stateDraft) : updater; },
    setDirty: (value: boolean) => { dirty = value; }, savedId,
    setSavedId: (value: string) => { savedId = value; },
    setDemoDialog: (dialog: { mode: string; launchStatus?: string } | null) => { if (dialog) dialogs.push(dialog); },
    parseAdsCampaignInput,
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      requests.push({ url, method: init?.method || "GET", body: init?.body });
      if (url === "/api/ads/accounts?provider=google") {
        if (options.editDuring === "accounts") edit();
        return { connected: true, connectionStatus: "connected", selectedAccountId: options.accountId || accountId,
          selectedAccountLabel: "Compte iNrCy", accounts: [{ id: options.accountId || accountId, name: "Compte iNrCy", currency: "EUR" }], pages: [] };
      }
      if (url === "/api/ads/google/resources") {
        if (options.editDuring === "resources") edit();
        return freshResources;
      }
      if (url === "/api/ads/campaigns") {
        assert.equal(init?.method, "POST");
        if (options.editDuring === "save") edit();
        return { campaign: { id: "saved-google-draft" } };
      }
      if (url === "/api/ads/campaigns/saved-google-draft/preflight?mode=live") {
        assert.equal(init?.method, undefined, "the publisher preflight must be read-only");
        if (options.revokeConsentDuringPreflight) { consent.current = null; confirmedSpend = false; }
        return { ready: options.publisherReady !== false, selectedAccountId: accountId, verifiedLocationCount: options.publisherLocationCount ?? 1 };
      }
      assert.equal(url, "/api/ads/campaigns/saved-google-draft/publish", "no other account or platform may be contacted");
      assert.equal(init?.method, "POST");
      return { campaign: { status: "active" } };
    },
    readJson: async (value: unknown) => value,
  };
  scope.confirmCampaignLaunch = actualFunction("confirmCampaignLaunch", scope);
  return {
    open: actualFunction("openLaunchDialog", scope), requests, dialogs, notices, consent,
    draft: () => stateDraft, dirty: () => dirty, confirmedSpend: () => confirmedSpend,
    confirm: () => actualFunction("confirmCampaignLaunch", { ...scope, draft: stateDraft, savedId, demoDialog: dialogs.at(-1) })(),
  };
}

test("Google IA sans consentement de dépense ne lance aucune requête", async () => {
  const harness = launchHarness();
  await harness.open(true);
  assert.deepEqual(harness.requests, []);
  assert.deepEqual(harness.dialogs, []);
});

test("le consentement Google couvre annonce, lien, UTM et enveloppe native exacts", async () => {
  for (const patch of [
    { headlines: ["Une autre promesse", "Titre deux", "Titre trois"] },
    { destinationUrl: "https://example.com/autre" },
    { trackingParameters: "utm_campaign=autre" },
    { googleDeliverySettings: { ...defaultGoogleDeliverySettings(), budget: { type: "total", totalEuros: 300 } } },
  ]) {
    const harness = launchHarness({ confirmedSpend: true });
    assert.ok(harness.consent.current);
    harness.consent.current.key = JSON.stringify({ ...harness.draft(), ...patch });
    await harness.open(true);
    assert.deepEqual(harness.requests, []);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("Google IA refuse un compte qui a changé entre le consentement et les lectures fraîches", async () => {
  const harness = launchHarness({ confirmedSpend: true, accountId: "9876543210" });
  await harness.open(true);
  assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
  assert.deepEqual(harness.dialogs, []);
});

test("Google IA refuse les conversions d’un autre compte et une optimisation sans conversion primaire", async () => {
  for (const options of [
    { resourcesAccountId: "9876543210" },
    { conversionsReady: false, bidStrategy: "maximize_conversions" as const },
  ]) {
    const harness = launchHarness({ confirmedSpend: true, ...options });
    await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("les objectifs réels ou le fuseau Google modifiés invalident le consentement malgré une stratégie encore disponible", async () => {
  for (const options of [{ changedGoal: true }, { changedTimeZone: true }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options });
    await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("un consentement Google sans preuve des objectifs affichés ne peut être enregistré ni publié", async () => {
  for (const googleResourcesKey of [undefined, "stale-resources"]) {
    const harness = launchHarness({ confirmedSpend: true });
    assert.ok(harness.consent.current);
    harness.consent.current.googleResourcesKey = googleResourcesKey;
    await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("Google IA stable relit le compte et les ressources, enregistre une fois puis publie le snapshot exact", async () => {
  const harness = launchHarness({ confirmedSpend: true });
  const expected = harness.draft();
  await harness.open(true);
  assert.deepEqual(harness.requests.map(({ url, method }) => `${method} ${url}`), [
    "GET /api/ads/accounts?provider=google", "GET /api/ads/google/resources",
    "POST /api/ads/campaigns", "GET /api/ads/campaigns/saved-google-draft/preflight?mode=live",
    "POST /api/ads/campaigns/saved-google-draft/publish",
  ], harness.notices.join(" "));
  const saved = JSON.parse(harness.requests.find(({ url }) => url === "/api/ads/campaigns")?.body || "{}");
  assert.equal(saved.adAccountId, expected.adAccountId);
  assert.deepEqual(saved.googleDeliverySettings, expected.googleDeliverySettings);
  assert.deepEqual(saved.headlines, expected.headlines);
  assert.deepEqual(saved.descriptions, expected.descriptions);
  assert.deepEqual(saved.keywords, expected.keywords);
  assert.equal(saved.trackingParameters, expected.trackingParameters);
  assert.deepEqual(JSON.parse(harness.requests.at(-1)?.body || "{}"), { mode: "live", confirmation: ADS_LIVE_PUBLISH_CONFIRMATION });
  assert.equal(harness.dialogs.length, 1);
  assert.equal(harness.dialogs[0].mode, "success", "no second consent dialog is opened");
  assert.equal(harness.confirmedSpend(), false);
  assert.equal(harness.consent.current, null);
});

test("une modification Google pendant les lectures conserve le brouillon local et empêche l’enregistrement", async () => {
  for (const editDuring of ["accounts", "resources"] as const) {
    const harness = launchHarness({ confirmedSpend: true, editDuring });
    await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
    assert.equal(harness.draft().headlines[0], "Une modification à conserver");
    assert.equal(harness.dirty(), true);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("une modification Google pendant l’enregistrement n’est pas écrasée et ne publie rien", async () => {
  const harness = launchHarness({ confirmedSpend: true, editDuring: "save" });
  await harness.open(true);
  assert.equal(harness.requests.filter(({ method }) => method === "POST").length, 1);
  assert.equal(harness.requests.some(({ url }) => url.endsWith("/publish")), false);
  assert.equal(harness.draft().headlines[0], "Une modification à conserver");
  assert.equal(harness.dirty(), true);
  assert.deepEqual(harness.dialogs, []);
});

test("Google IA échoue fermé si le publisher refuse, ne vérifie aucune zone ou si le consentement est révoqué", async () => {
  for (const options of [{ publisherReady: false }, { publisherLocationCount: 0 }, { revokeConsentDuringPreflight: true }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options });
    await harness.open(true);
    assert.equal(harness.requests.some(({ url }) => url.endsWith("/publish")), false);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("Google manuel conserve la confirmation préalable et un seul enregistrement au lancement", async () => {
  const harness = launchHarness({ creationMode: "manual" });
  await harness.open();
  assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
  assert.equal(harness.dialogs.length, 1);
  assert.equal(harness.dialogs[0].mode, "confirm");
  await harness.confirm();
  assert.equal(harness.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 1);
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 1);
  assert.equal(harness.dialogs.at(-1)?.mode, "success");
});
