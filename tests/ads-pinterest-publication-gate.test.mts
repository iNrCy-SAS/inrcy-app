import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { defaultPinterestDeliverySettings } from "../lib/adsPinterestCampaignSettings.ts";
import { pinterestAdsResourcesConsentKey, resolvePinterestAdsGeographies, type PinterestAdsResources } from "../lib/adsPinterestResources.ts";
import { matchPinterestTargetLanguages } from "../lib/adsPinterestLocations.ts";
import { adsDestinationReviewState } from "../lib/adsDestination.ts";
import { adsIncompleteLaunchMessage, adsIncompleteLaunchSteps } from "../lib/adsLaunchReadiness.ts";
import { ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION } from "../lib/adsPublishMode.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name: string, scope: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(declaration, `${name} must exist`);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}

const accountId = "1234567890";
function campaign(creationMode: "manual" | "inrcy" = "inrcy") {
  const settings = defaultPinterestDeliverySettings();
  settings.budget = { type: "total", totalEuros: 200, flexibleDaily: false, startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), endAt: new Date(Date.now() + 8 * 86_400_000).toISOString() };
  const parsed = parseAdsCampaignInput({
    provider: "pinterest", creationMode, campaignType: "generic", objective: "website_traffic", conversionGoal: "website_visit",
    conversionLocation: "website", adAccountId: accountId, accountCurrency: "EUR", name: "Découvrir iNrCy", bidStrategy: "maximize_clicks",
    dailyBudgetEuros: 25, endDate: settings.budget.endAt!.slice(0, 10),
    destinationUrl: "https://example.com/offre", trackingParameters: "utm_source=pinterest&utm_campaign=inrcy",
    headlines: ["Découvrez iNrCy"], primaryText: "Un outil pour simplifier votre activité professionnelle.", descriptions: [], keywords: [], negativeKeywords: [],
    targetLocations: ["France: Nord"], languages: ["fr"], creativeType: "image", mediaStrategy: "image", creativeUrl: "https://cdn.example.fr/pin.png",
    channelSettings: { schemaVersion: 1, channel: "pinterest", objectiveType: "CONSIDERATION", intendedPromotionType: "STANDARD_AD", creativeType: "REGULAR", targetingMode: "automatic", conversionEvent: null },
    pinterestDeliverySettings: settings,
  }, { purpose: "publish" });
  assert.ok(parsed.draft, parsed.error || "Pinterest fixture must be valid");
  return parsed.draft;
}

function launchHarness(options: {
  creationMode?: "manual" | "inrcy"; confirmedSpend?: boolean; accountId?: string; canManage?: boolean; resourcesAccountId?: string;
  editDuring?: "accounts" | "resources" | "save"; revokeConsentDuringPreflight?: boolean;
  publisherReady?: boolean; publisherLocationCount?: number; publisherLanguageCount?: number; publisherResourcesKey?: string;
  changedTimeZone?: boolean; changedGeography?: boolean; changedLanguage?: boolean; destinationConfirmed?: boolean; destinationValid?: boolean;
  targetLocations?: string[]; languages?: string[];
} = {}) {
  const draft = { ...campaign(options.creationMode), ...(options.targetLocations ? { targetLocations: options.targetLocations } : {}), ...(options.languages ? { languages: options.languages } : {}) };
  let stateDraft = draft;
  let dirty = true;
  let savedId: string | null = null;
  let confirmedSpend = options.confirmedSpend === true;
  const consent: { current: { key: string; status: string; pinterestResourcesKey?: string } | null } = { current: null };
  const dialogs: Array<{ mode: string; launchStatus?: string }> = [];
  const notices: string[] = [];
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const noop = () => {};
  const edit = () => { stateDraft = { ...stateDraft, headlines: ["Une modification à conserver"] }; dirty = true; confirmedSpend = false; consent.current = null; };
  const resources: PinterestAdsResources = {
    selectedAccountId: options.resourcesAccountId || accountId,
    account: { id: options.resourcesAccountId || accountId, name: "Compte iNrCy", currency: "EUR", country: "FR", timezone: "Europe/Paris" },
    geographies: [{ id: "250059", name: "France: Nord", type: "LOCATION", kind: "metro" }],
    locales: [{ id: "fr", name: "français" }, { id: "en", name: "anglais" }],
  };
  consent.current = confirmedSpend ? { key: JSON.stringify(draft), status: "active", pinterestResourcesKey: pinterestAdsResourcesConsentKey(resources) } : null;
  const freshResources: PinterestAdsResources = {
    ...resources,
    ...(options.changedTimeZone ? { account: { ...resources.account, timezone: "UTC" } } : {}),
    ...(options.changedGeography ? { geographies: [{ id: "250062", name: "France: Pas-de-Calais", type: "LOCATION", kind: "metro" }] } : {}),
    ...(options.changedLanguage ? { locales: [{ id: "en", name: "anglais" }] } : {}),
  };
  const scope: Record<string, unknown> = {
    channelId: "pinterest", provider: "pinterest", channelMeta: { label: "Pinterest Ads" }, draft,
    channelPublishingEnabled: true, isAdsDraftAccountChannel: () => true,
    busy: null, demoSubmissionRef: { current: false }, demoDialog: null,
    creating: true, creationPath: options.creationMode === "manual" ? "manual" : "inrcy",
    step: options.creationMode === "manual" ? 10 : 11, validationStep: options.creationMode === "manual" ? 10 : 11,
    destinationReview: { required: true, valid: options.destinationValid !== false, confirmed: options.destinationConfirmed !== false },
    confirmedSpend, linkedInLaunchConsent: consent, effectivePinterestResources: resources,
    defaultPinterestDeliverySettings, pinterestAdsResourcesConsentKey, resolvePinterestAdsGeographies, matchPinterestTargetLanguages,
    ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION,
    unsupportedAdsConnectorReason: () => null, liveFormatAvailable: true, livePublisherConversionReady: true,
    metaLivePlacementsSupported: true, livePublisherMediaReady: true,
    setNotice: (notice: string) => notices.push(notice), setBusy: noop, setPublicationPhase: noop,
    setConfirmedSpend: (value: boolean) => { confirmedSpend = value; }, setExternalStatuses: noop,
    setPinterestResources: noop, setPinterestResourcesLoad: noop,
    setDraft: (updater: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { stateDraft = typeof updater === "function" ? updater(stateDraft) : updater; },
    setDirty: (value: boolean) => { dirty = value; }, savedId, setSavedId: (value: string) => { savedId = value; },
    setDemoDialog: (dialog: { mode: string; launchStatus?: string } | null) => { if (dialog) dialogs.push(dialog); }, parseAdsCampaignInput,
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      requests.push({ url, method: init?.method || "GET", body: init?.body });
      if (url === "/api/ads/pinterest/accounts") {
        if (options.editDuring === "accounts") edit();
        return { selectedAccountId: options.accountId || accountId, selectedAccountName: "Compte iNrCy", accounts: [{ id: options.accountId || accountId, name: "Compte iNrCy", currency: "EUR", canManageCampaigns: options.canManage !== false }] };
      }
      if (url === "/api/ads/pinterest/resources") { if (options.editDuring === "resources") edit(); return freshResources; }
      if (url === "/api/ads/campaigns") { assert.equal(init?.method, "POST"); if (options.editDuring === "save") edit(); return { campaign: { id: "saved-pinterest-draft" } }; }
      if (url === "/api/ads/campaigns/saved-pinterest-draft/preflight?mode=live") {
        assert.equal(init?.method, undefined, "the publisher preflight must be read-only");
        if (options.revokeConsentDuringPreflight) { consent.current = null; confirmedSpend = false; }
        return { ready: options.publisherReady !== false, selectedAccountId: accountId, verifiedLocationCount: options.publisherLocationCount ?? 1, verifiedLanguageCount: options.publisherLanguageCount ?? 1, resourcesKey: options.publisherResourcesKey ?? pinterestAdsResourcesConsentKey(resources) };
      }
      assert.equal(url, "/api/ads/campaigns/saved-pinterest-draft/publish", "no other account or platform may be contacted");
      assert.equal(init?.method, "POST");
      return { campaign: { status: "active" } };
    }, readJson: async (value: unknown) => value,
  };
  scope.confirmCampaignLaunch = actualFunction("confirmCampaignLaunch", scope);
  return { open: actualFunction("openLaunchDialog", scope), requests, dialogs, notices, consent, resources,
    draft: () => stateDraft, dirty: () => dirty, confirmedSpend: () => confirmedSpend,
    confirm: () => actualFunction("confirmCampaignLaunch", { ...scope, draft: stateDraft, savedId, demoDialog: dialogs.at(-1) })(),
  };
}

test("Pinterest IA sans consentement de dépense ne lance aucune requête", async () => {
  const harness = launchHarness(); await harness.open(true); assert.deepEqual(harness.requests, []); assert.deepEqual(harness.dialogs, []);
});

test("Pinterest IA exige aussi un lien valide et confirmé avant toute lecture de compte", async () => {
  for (const options of [{ destinationConfirmed: false }, { destinationValid: false }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options }); await harness.open(true);
    assert.deepEqual(harness.requests, []); assert.deepEqual(harness.dialogs, []);
  }
});

test("le consentement Pinterest couvre le Pin, le lien, les langues et le budget natif exacts", async () => {
  for (const patch of [{ headlines: ["Une autre promesse"] }, { primaryText: "Une autre proposition" }, { creativeUrl: "https://cdn.example.fr/autre.png" }, { destinationUrl: "https://example.com/autre" }, { trackingParameters: "utm_campaign=autre" }, { languages: ["en"] }, { pinterestDeliverySettings: defaultPinterestDeliverySettings() }]) {
    const harness = launchHarness({ confirmedSpend: true }); assert.ok(harness.consent.current);
    harness.consent.current.key = JSON.stringify({ ...harness.draft(), ...patch }); await harness.open(true);
    assert.deepEqual(harness.requests, []); assert.deepEqual(harness.dialogs, []);
  }
});

test("Pinterest refuse un compte différent ou sans droit de gestion avant tout enregistrement", async () => {
  for (const options of [{ accountId: "9876543210" }, { resourcesAccountId: "9876543210" }, { canManage: false }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options }); await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false); assert.deepEqual(harness.dialogs, []);
  }
});

test("Pinterest ne remplace aucune zone ou langue non reconnue par un choix approximatif", async () => {
  for (const options of [{ targetLocations: ["Lille"] }, { languages: ["xx"] }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options }); await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false); assert.deepEqual(harness.dialogs, []);
  }
});

test("Pinterest refuse un accord de création en pause lorsque la proposition fraîche est active", async () => {
  const harness = launchHarness({ confirmedSpend: true }); assert.ok(harness.consent.current); harness.consent.current.status = "paused";
  await harness.open(true); assert.equal(harness.requests.some(({ method }) => method === "POST"), false); assert.deepEqual(harness.dialogs, []);
});

test("le fuseau ou les catalogues Pinterest actualisés invalident l’accord affiché", async () => {
  for (const options of [{ changedTimeZone: true }, { changedGeography: true }, { changedLanguage: true }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options }); await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false); assert.deepEqual(harness.dialogs, []);
    assert.equal(harness.consent.current, null);
  }
});

test("une preuve des ressources Pinterest absente ou périmée empêche l’enregistrement", async () => {
  for (const key of [undefined, "stale-resources"]) {
    const harness = launchHarness({ confirmedSpend: true }); assert.ok(harness.consent.current); harness.consent.current.pinterestResourcesKey = key;
    await harness.open(true); assert.equal(harness.requests.some(({ method }) => method === "POST"), false);
  }
});

test("Pinterest IA stable vérifie le compte et les ressources, enregistre une fois puis publie le snapshot relu", async () => {
  const harness = launchHarness({ confirmedSpend: true }); const expected = harness.draft(); await harness.open(true);
  assert.deepEqual(harness.requests.map(({ url, method }) => `${method} ${url}`), [
    "GET /api/ads/pinterest/accounts", "GET /api/ads/pinterest/resources", "POST /api/ads/campaigns", "GET /api/ads/campaigns/saved-pinterest-draft/preflight?mode=live", "POST /api/ads/campaigns/saved-pinterest-draft/publish",
  ], harness.notices.join(" "));
  const saved = JSON.parse(harness.requests.find(({ url }) => url === "/api/ads/campaigns")?.body || "{}");
  assert.deepEqual(saved, JSON.parse(JSON.stringify(expected)), "No field from the approved Pin may be dropped or replaced");
  assert.equal(saved.pinterestDeliverySettings.budget.totalEuros, 200); assert.equal(saved.dailyBudgetEuros, 25);
  assert.deepEqual(JSON.parse(harness.requests.at(-1)?.body || "{}"), { mode: "live", confirmation: ADS_LIVE_PUBLISH_CONFIRMATION });
  assert.equal(harness.dialogs.length, 1); assert.equal(harness.dialogs[0].mode, "success", "No second confirmation dialog is opened");
  assert.equal(harness.confirmedSpend(), false); assert.equal(harness.consent.current, null);
});

test("une modification pendant les lectures Pinterest conserve les choix locaux et empêche la sauvegarde", async () => {
  for (const editDuring of ["accounts", "resources"] as const) {
    const harness = launchHarness({ confirmedSpend: true, editDuring }); await harness.open(true);
    assert.equal(harness.requests.some(({ method }) => method === "POST"), false); assert.equal(harness.draft().headlines[0], "Une modification à conserver"); assert.equal(harness.dirty(), true); assert.deepEqual(harness.dialogs, []);
  }
});

test("une modification pendant la sauvegarde Pinterest n’est pas écrasée et ne publie rien", async () => {
  const harness = launchHarness({ confirmedSpend: true, editDuring: "save" }); await harness.open(true);
  assert.equal(harness.requests.filter(({ method }) => method === "POST").length, 1); assert.equal(harness.requests.some(({ url }) => url.endsWith("/publish")), false);
  assert.equal(harness.draft().headlines[0], "Une modification à conserver"); assert.equal(harness.dirty(), true); assert.deepEqual(harness.dialogs, []);
});

test("Pinterest échoue fermé si le préflight refuse une zone, une langue, la preuve ou si le consentement est révoqué", async () => {
  for (const options of [{ publisherReady: false }, { publisherLocationCount: 0 }, { publisherLocationCount: 2 }, { publisherLanguageCount: 0 }, { publisherResourcesKey: "changed-native-context" }, { revokeConsentDuringPreflight: true }]) {
    const harness = launchHarness({ confirmedSpend: true, ...options }); await harness.open(true);
    assert.equal(harness.requests.some(({ url }) => url.endsWith("/publish")), false); assert.deepEqual(harness.dialogs, []);
  }
});

test("Pinterest manuel conserve son dialogue préalable et une seule sauvegarde au lancement", async () => {
  const harness = launchHarness({ creationMode: "manual" }); await harness.open();
  assert.equal(harness.requests.some(({ method }) => method === "POST"), false); assert.equal(harness.dialogs.length, 1); assert.equal(harness.dialogs[0].mode, "confirm");
  const confirmation = harness.dialogs[0] as { mode: string; details: { pinterestBudget: Record<string, unknown> } };
  const budget = harness.draft().pinterestDeliverySettings!.budget;
  assert.deepEqual(confirmation.details.pinterestBudget, { type: "total", totalEuros: 200, startAt: budget.startAt, endAt: budget.endAt, timeZone: "Europe/Paris", flexibleDaily: false });
  await harness.confirm(); assert.equal(harness.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 1);
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 1); assert.equal(harness.dialogs.at(-1)?.mode, "success");
});

function findAll(predicate: (node: ts.Node) => boolean, root: ts.Node = source): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); }; visit(root); return result;
}
function evaluate(node: ts.Node, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`const value = (${node.getText(source)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn value;`)(...Object.values(scope));
}
function initializer(name: string, scope: Record<string, unknown>) {
  const variable = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0] as ts.VariableDeclaration | undefined;
  assert.ok(variable?.initializer, `${name} must exist`); return evaluate(variable.initializer, scope);
}
function markedLabel(marker: string) {
  const labels = findAll((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "label"
    && node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === marker));
  assert.equal(labels.length, 1, `${marker} must have one owner`); return labels[0];
}
function field(name: string, root: ts.Node) {
  const attribute = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(source) === name, root)[0] as ts.JsxAttribute | undefined;
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression, `${name} must exist`); return attribute.initializer.expression;
}
function finalConfirmationHarness() {
  let draft = campaign(); let confirmedSpend = false; let confirmedDestinationUrl = ""; let dirty = false;
  const resources = launchHarness().resources;
  const consent: { current: { key: string; status: string; pinterestResourcesKey?: string } | null } = { current: null };
  const scope = () => {
    const destinationReview = adsDestinationReviewState({ assisted: true, fieldVisible: true, websiteRequired: true, destinationUrl: draft.destinationUrl, confirmedUrl: confirmedDestinationUrl });
    const base: Record<string, unknown> = {
      channelId: "pinterest", creationPath: "inrcy", draft, busy: null, reviewAccountReady: true,
      pinterestResourcesLoad: "ready", effectivePinterestResources: resources, effectiveGoogleResources: null,
      effectiveOpenaiResources: null,
      googleLaunchReadinessReason: "", linkedInLaunchReadinessReason: "", pinterestLaunchReadinessReason: "", metaLaunchReadinessReason: "", openaiLaunchReadinessReason: "", launchUnavailableReason: "",
      destinationReview, adsIncompleteLaunchSteps, adsIncompleteLaunchMessage,
      foundationsStep: 2, budgetStep: 3, geographyStep: 4, targetingStep: 5, biddingStep: 6, pinterestFormatStep: 7, keywordsStep: -1,
      creativeStep: 8, mediaStep: 9, deliveryStep: 10, validationStep: 11,
      livePublisherMediaReady: true, linkedInLaunchConsent: consent, confirmedSpend, pinterestAdsResourcesConsentKey,
      setDraft: (next: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { draft = typeof next === "function" ? next(draft) : next; },
      setDirty: (value: boolean) => { dirty = value; }, setConfirmedSpend: (value: boolean) => { confirmedSpend = value; },
      setConfirmedDestinationUrl: (value: string) => { confirmedDestinationUrl = value; },
      applyDraftEdit: actualFunction("applyDraftEdit", {}),
    };
    base.updateDraft = (next: Partial<AdsCampaignInput>) => actualFunction("updateDraft", scope())(next);
    base.incompleteLaunchSteps = initializer("incompleteLaunchSteps", base);
    base.incompleteLaunchMessage = initializer("incompleteLaunchMessage", base);
    base.launchBlockingMessage = initializer("launchBlockingMessage", base);
    base.launchBlocked = initializer("launchBlocked", base); return base;
  };
  const button = findAll((node) => ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "button"
    && node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "onClick" && attribute.getText(source).includes("openLaunchDialog(")))[0];
  assert.ok(button);
  return { consent, resources, draft: () => draft, spend: () => confirmedSpend, dirty: () => dirty,
    budgetDisabled: (patch: Record<string, unknown> = {}) => evaluate(field("disabled", markedLabel("data-pinterest-launch-confirmation")), { ...scope(), ...patch }),
    launchDisabled: () => evaluate(field("disabled", button), scope()),
    budget: (checked: boolean) => evaluate(field("onChange", markedLabel("data-pinterest-launch-confirmation")), scope())({ target: { checked } }),
    destination: (checked: boolean) => evaluate(field("onChange", markedLabel("data-pinterest-destination-confirmation")), scope())({ target: { checked } }),
    edit: (next: Partial<AdsCampaignInput>) => actualFunction("updateDraft", scope())(next),
  };
}

test("Pinterest permet budget puis lien ou lien puis budget ; seul VALIDER attend toutes les confirmations", () => {
  for (const order of [["budget", "destination"], ["destination", "budget"]] as const) {
    const harness = finalConfirmationHarness(); assert.equal(harness.budgetDisabled(), false); assert.equal(harness.launchDisabled(), true);
    for (const [index, confirmation] of order.entries()) {
      harness[confirmation](true); assert.equal(harness.launchDisabled(), index < order.length - 1);
      if (harness.spend()) { assert.equal(harness.consent.current?.key, JSON.stringify(harness.draft())); assert.equal(harness.consent.current?.pinterestResourcesKey, pinterestAdsResourcesConsentKey(harness.resources)); }
    }
    harness.destination(false); assert.equal(harness.launchDisabled(), true); assert.equal(harness.spend(), true);
    harness.destination(true); assert.equal(harness.launchDisabled(), false); assert.equal(harness.spend(), true);
  }
});

test("la case de budget Pinterest attend les ressources exactes et des réglages valides", () => {
  const harness = finalConfirmationHarness(); assert.equal(harness.budgetDisabled(), false);
  for (const patch of [{ busy: "demo" }, { reviewAccountReady: false }, { pinterestResourcesLoad: "loading" }, { pinterestResourcesLoad: "error" }, { effectivePinterestResources: null }, { pinterestLaunchReadinessReason: "Zone native à vérifier" }]) assert.equal(harness.budgetDisabled(patch), true);
});

test("une vraie modification du Pin ou de sa livraison annule le consentement exact Pinterest", () => {
  for (const patch of [{ headlines: ["Une autre épingle"] }, { primaryText: "Un autre message" }, { destinationUrl: "https://example.com/autre" }, { languages: ["en"] }, { pinterestDeliverySettings: defaultPinterestDeliverySettings() }]) {
    const harness = finalConfirmationHarness(); harness.budget(true); harness.destination(true); assert.equal(harness.launchDisabled(), false);
    harness.edit(patch); assert.equal(harness.spend(), false); assert.equal(harness.consent.current, null); assert.equal(harness.launchDisabled(), true); assert.equal(harness.dirty(), true);
  }
});
