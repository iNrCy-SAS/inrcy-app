import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { defaultLinkedInDeliverySettings } from "../lib/adsLinkedInCampaignSettings.ts";
import { ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION } from "../lib/adsPublishMode.ts";
import { normalizeLinkedInGeoTargets, parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";
import { buildLinkedInGeoQueries, linkedInGeoQueryKey } from "../lib/adsLinkedInGeoQueries.ts";
import {
  linkedInAdsAutomaticPreflightKey,
  linkedInAdsContextualGeoDefaults,
  linkedInAdsLaunchBlockerMessage,
  linkedInAdsLaunchBlockers,
  linkedInAdsLaunchPreflightKey,
  linkedInAdsVerifiedBidDefault,
} from "../lib/adsLinkedInClientDefaults.ts";

const source = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findAll(predicate: (node: ts.Node) => boolean, root: ts.Node = source): ts.Node[] {
  const result: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function variable(name: string) {
  const declaration = findAll((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0] as ts.VariableDeclaration | undefined;
  assert.ok(declaration?.initializer, `${name} must exist`);
  return declaration.initializer;
}

function expression(node: ts.Node, scope: Record<string, unknown>) {
  return new Function(...Object.keys(scope), `return (${node.getText(source)});`)(...Object.values(scope));
}

function dialogGate(name: string, scope: Record<string, unknown>): boolean {
  const attribute = findAll((node) => ts.isJsxAttribute(node) && node.name.getText(source) === name)[0] as ts.JsxAttribute;
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression);
  return expression(attribute.initializer.expression, scope);
}

function actualFunction(name: string, scope: Record<string, unknown>) {
  const declaration = findAll((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)[0];
  assert.ok(declaration, `${name} must exist`);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}

function gateScope(channelId: string, livePublishingEnabled: boolean, publicationEnabled: unknown, load = "ready", googlePublishingEnabled = true, pinterestPublishingEnabled = true) {
  const scope: Record<string, unknown> = {
    channelId,
    livePublishingEnabled,
    googlePublishingEnabled,
    pinterestPublishingEnabled,
    externalStatuses: { linkedin: { load, publicationEnabled } },
    demoDialog: { channelId },
    linkedInPreflight: { account: { canServeCampaigns: true, canManageCampaigns: true }, blockers: [] },
    linkedInAdsLaunchBlockers,
    selectedLinkedInCampaignGroup: { status: "ACTIVE" },
  };
  scope.linkedInPublishingEnabled = expression(variable("linkedInPublishingEnabled"), scope);
  return scope;
}

test("the four channel gates remain independent in opening and both launch modes", () => {
  for (const global of [false, true]) {
    for (const dedicated of [false, true]) {
      for (const googleEnabled of [false, true]) {
        for (const pinterestEnabled of [false, true]) {
          for (const channel of ["linkedin", "meta", "google", "pinterest"]) {
            const scope = gateScope(channel, global, dedicated, "ready", googleEnabled, pinterestEnabled);
            const expected = { linkedin: dedicated, meta: global, google: googleEnabled, pinterest: pinterestEnabled }[channel];
            assert.equal(expression(variable("channelPublishingEnabled"), scope), expected, `${channel}, global=${global}, dedicated=${dedicated}`);
            assert.equal(dialogGate("activeEnabled", scope), expected);
            assert.equal(dialogGate("pausedEnabled", scope), expected);
          }
        }
      }
    }
  }
});

test("SSR snapshots, unavailable status and non-boolean approvals cannot authorize LinkedIn", () => {
  const snapshot = actualFunction("externalStatusFromSnapshot", {})({ status: "connected", accountId: "123", accountLabel: "LinkedIn" });
  assert.equal(snapshot.publicationEnabled, false);
  for (const load of ["idle", "loading", "error"]) {
    const scope = gateScope("linkedin", true, true, load);
    assert.equal(expression(variable("channelPublishingEnabled"), scope), false);
    assert.equal(dialogGate("activeEnabled", scope), false);
    assert.equal(dialogGate("pausedEnabled", scope), false);
  }
  for (const approval of [undefined, null, "true", 1, false]) {
    assert.equal(expression(variable("channelPublishingEnabled"), gateScope("linkedin", true, approval)), false);
  }
});

test("an enabled LinkedIn gate still requires manageable resources and an ACTIVE parent to serve", () => {
  const scope = gateScope("linkedin", false, true);
  scope.linkedInPreflight = { account: { canServeCampaigns: false, canManageCampaigns: true }, blockers: ["account_not_serving"] };
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), true);
  scope.linkedInPreflight = { account: { canServeCampaigns: true, canManageCampaigns: true }, blockers: ["campaign_group_not_active"] };
  scope.selectedLinkedInCampaignGroup = { status: "PAUSED" };
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), true);
  scope.linkedInPreflight = null;
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), false);
});

function statusUpdaters(owner: string) {
  return findAll((node) => ts.isCallExpression(node) && node.expression.getText(source) === "setExternalStatuses", variable(owner))
    .map((node) => (node as ts.CallExpression).arguments[0]);
}

test("only status verification owns the LinkedIn gate; silent refresh revokes it and account discovery cannot overwrite it", () => {
  const current = { linkedin: { load: "ready", publicationEnabled: true } };
  const [start, success, failure] = statusUpdaters("refreshExternalStatus");
  const refreshing = expression(start, { channel: "linkedin", options: { silent: true } })(current);
  assert.equal(refreshing.linkedin.publicationEnabled, false);
  const verified = expression(success, {
    channel: "linkedin", data: { publicationEnabled: true }, status: "connected", selectedAccountId: "123",
    selectedAccountName: "LinkedIn", scopes: [], missingScopes: [],
  })(refreshing);
  assert.equal(verified.linkedin.publicationEnabled, true);
  const unavailable = expression(failure, { channel: "linkedin", error: new Error("unavailable") })(refreshing);
  assert.equal(unavailable.linkedin.load, "error");
  assert.equal(unavailable.linkedin.publicationEnabled, false);
  const [accounts] = statusUpdaters("loadExternalAccounts");
  for (const approved of [false, true]) {
    const updated = expression(accounts, { channel: "linkedin", data: { publicationEnabled: !approved } })({ linkedin: { load: "ready", publicationEnabled: approved } });
    assert.equal(updated.linkedin.publicationEnabled, approved, "account results must not grant or revoke the status gate");
  }
});

test("opening and confirming a disabled LinkedIn launch return before any account, draft or publish request", async () => {
  let requests = 0;
  const notices: string[] = [];
  const scope = {
    channelId: "linkedin", channelPublishingEnabled: false, channelMeta: { label: "LinkedIn Ads" },
    isAdsDraftAccountChannel: () => true, busy: null, demoSubmissionRef: { current: false },
    linkedInSelectionsReady: true, linkedInComplianceReady: true, demoDialog: null,
    setNotice: (notice: string) => notices.push(notice), setBusy: () => {}, setDemoDialog: () => {}, setPublicationPhase: () => {},
    creating: true, step: 5, validationStep: 5,
    fetch: () => { requests += 1; throw new Error("unexpected request"); },
  };
  await actualFunction("openLaunchDialog", scope)();
  await actualFunction("confirmCampaignLaunch", { ...scope, demoDialog: { mode: "confirm", channelId: "linkedin" } })();
  assert.equal(requests, 0);
  assert.equal(notices.filter((notice) => notice.includes("momentanément verrouillé")).length, 2);
});

const launchGroup = {
  id: "987", urn: "urn:li:sponsoredCampaignGroup:987", name: "Groupe vérifié", status: "ACTIVE",
  objectiveType: "WEBSITE_VISIT", allowedCampaignTypes: ["SPONSORED_UPDATES"],
};
const launchOrganization = { urn: "urn:li:organization:456", role: "ADMINISTRATOR" };
const launchGeo = { urn: "urn:li:geo:104609892", name: "Arras, Hauts-de-France, France", facetUrn: "urn:li:adTargetingFacet:locations" };
const launchPricing = { currency: "EUR", bidMin: 1, bidMax: 5, dailyBudgetMin: 10, dailyBudgetDefault: 25 };
function freshLaunchPreflight(blockers: string[] = ["available_image_required"]) {
  return {
    account: { id: "12345", currency: "EUR", canManageCampaigns: true, canServeCampaigns: true },
    campaignGroups: [launchGroup], organizations: [launchOrganization],
    selected: {
      campaignGroup: launchGroup, organization: launchOrganization,
      verifiedGeoTargets: [launchGeo], verifiedGeoUrns: [launchGeo.urn], pricing: launchPricing, bidAmount: 2,
    },
    geoResolutions: [{ query: "Arras", suggestions: [launchGeo], autoSelectedUrn: launchGeo.urn }],
    blockers,
  };
}

function launchHarness(options: {
  initialDraft?: Partial<AdsCampaignInput>;
  responses?: ReturnType<typeof freshLaunchPreflight>[];
  staleSelectionsReady?: boolean;
  publicationCheck?: { ready?: boolean; verifiedGeoCount?: number };
  savedId?: string | null;
  confirmedSpend?: boolean;
  agreedStatus?: "active" | "paused";
  revokeConsentDuringPublisherCheck?: boolean;
  editedTextDuringResourceCheck?: string;
  editedTextDuringSave?: string;
} = {}) {
  const draft = {
    provider: "linkedin", adAccountId: "12345", accountCurrency: "EUR", name: "Campagne", targetLocations: ["Arras"],
    dailyBudgetEuros: 25, endDate: new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10), linkedinCampaignGroupId: launchGroup.id,
    linkedinOrganizationUrn: launchOrganization.urn, linkedinGeoTargets: [{ urn: launchGeo.urn, name: launchGeo.name }],
    linkedinBidEuros: 2, linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true,
    destinationUrl: "https://example.com", imageUrl: "https://example.com/image.jpg", creativeType: "image", mediaStrategy: "image",
    primaryText: "Découvrez notre accompagnement pour les entreprises.", headlines: ["Votre campagne LinkedIn"],
    channelSettings: { schemaVersion: 1, channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", targetingFacet: "titles", locale: { language: "fr", country: "FR" } },
    ...options.initialDraft,
  } as AdsCampaignInput;
  let stateDraft = draft;
  const notices: string[] = [];
  const dialogs: Array<{ launchStatus: string }> = [];
  const requestedDrafts: AdsCampaignInput[] = [];
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  let savedId: string | null = options.savedId || null;
  let consentChecked = options.confirmedSpend === true;
  let dirty = true;
  const events: string[] = [];
  const consent = { current: options.confirmedSpend === true ? {
    key: JSON.stringify(draft), status: options.agreedStatus || "active",
  } : null };
  const responses = options.responses || [freshLaunchPreflight()];
  const noop = () => {};
  const scope: Record<string, unknown> = {
    channelId: "linkedin", channelMeta: { label: "LinkedIn Ads" }, draft,
    channelPublishingEnabled: true, isAdsDraftAccountChannel: () => true,
    busy: null, demoSubmissionRef: { current: false }, demoDialog: null,
    creating: true, creationPath: draft.creationMode === "inrcy" ? "inrcy" : "manual", step: 10, validationStep: 10,
    destinationReview: { required: true, valid: true, confirmed: true },
    confirmedSpend: consentChecked,
    linkedInLaunchConsent: consent,
    ADS_LIVE_PUBLISH_CONFIRMATION, ADS_PAUSED_PUBLISH_CONFIRMATION,
    externalStatuses: { linkedin: { selectedAccountId: "12345" } },
    linkedInAdsAutomaticPreflightKey,
    linkedInSelectionsReady: options.staleSelectionsReady ?? true, linkedInComplianceReady: true,
    unsupportedAdsConnectorReason: () => null, liveFormatAvailable: true, livePublisherConversionReady: true,
    metaLivePlacementsSupported: true, livePublisherMediaReady: true,
    setNotice: (value: string) => notices.push(value), setBusy: noop,
    setConfirmedSpend: (value: boolean) => { consentChecked = value; },
    setPublicationPhase: noop, setExternalStatuses: noop, setLinkedInPreflightLoad: noop, setLinkedInPreflightError: noop,
    setDemoDialog: (value: { launchStatus: string }) => dialogs.push(value),
    setDraft: (updater: AdsCampaignInput | ((current: AdsCampaignInput) => AdsCampaignInput)) => { stateDraft = typeof updater === "function" ? updater(stateDraft) : updater; },
    setDirty: (value: boolean) => { dirty = value; }, linkedInGeoDismissedUrns: { current: new Set<string>() },
    normalizeLinkedInGeoTargets, parseAdsCampaignInput, linkedInAdsContextualGeoDefaults, linkedInAdsLaunchBlockerMessage,
    linkedInAdsLaunchBlockers, linkedInAdsLaunchPreflightKey, linkedInAdsVerifiedBidDefault,
    applyDraftEdit: actualFunction("applyDraftEdit", {}),
    linkedInCampaignGroupIsCompatible: actualFunction("linkedInCampaignGroupIsCompatible", {}),
    savedId,
    setSavedId: (value: string) => { savedId = value; },
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      requests.push({ url, method: init?.method || "GET", body: init?.body });
      events.push(`${init?.method || "GET"} ${url}`);
      if (url === "/api/ads/linkedin/accounts") {
        return { accounts: [{ id: "12345", currency: "EUR", canManageCampaigns: true }], selectedAccountId: "12345", selectedAccountCanManage: true, selectedAccountCanServe: true };
      }
      if (url === "/api/ads/campaigns") {
        assert.equal(init?.method, "POST");
        if (options.editedTextDuringSave) {
          stateDraft = { ...stateDraft, primaryText: options.editedTextDuringSave };
          dirty = true;
          consentChecked = false;
          consent.current = null;
        }
        return { campaign: { id: "saved-draft" } };
      }
      if (url === "/api/ads/campaigns/saved-draft/publish") {
        assert.equal(init?.method, "POST");
        const body = JSON.parse(init?.body || "{}");
        return { campaign: { status: body.mode === "paused" ? "paused" : "active" } };
      }
      assert.match(url, /^\/api\/ads\/campaigns\/saved-draft\/preflight\?mode=(live|paused)$/);
      assert.equal(init?.method, undefined, "pre-publication verification is read-only");
      if (options.revokeConsentDuringPublisherCheck) {
        consent.current = null;
        consentChecked = false;
      }
      return options.publicationCheck || { ready: true, verifiedGeoCount: 1 };
    },
    readJson: async (value: unknown) => value,
    fetchLinkedInPreflight: async (_query: unknown, force: boolean, accountId: string, effectiveDraft: AdsCampaignInput) => {
      assert.equal(force, true);
      assert.equal(accountId, "12345");
      requestedDrafts.push(effectiveDraft);
      events.push("GET LinkedIn resources");
      if (requestedDrafts.length === 1 && options.editedTextDuringResourceCheck) {
        stateDraft = { ...stateDraft, primaryText: options.editedTextDuringResourceCheck };
        dirty = true;
        consentChecked = false;
        consent.current = null;
      }
      return responses[Math.min(requestedDrafts.length - 1, responses.length - 1)];
    },
  };
  scope.applyLinkedInProviderDefaults = actualFunction("applyLinkedInProviderDefaults", scope);
  scope.confirmCampaignLaunch = actualFunction("confirmCampaignLaunch", scope);
  return {
    open: actualFunction("openLaunchDialog", scope), notices, dialogs, requestedDrafts, requests, events, consent,
    currentDraft: () => stateDraft, currentSavedId: () => savedId, consentChecked: () => consentChecked,
    isDirty: () => dirty,
    confirm: () => actualFunction("confirmCampaignLaunch", { ...scope, draft: stateDraft, savedId, demoDialog: dialogs.at(-1) })(),
  };
}

test("the actual launch handler ignores stale readiness and uses the freshly reread LinkedIn blockers", async () => {
  const ready = launchHarness({ staleSelectionsReady: false });
  await ready.open();
  assert.equal(ready.dialogs.length, 1, "fresh verified resources permit confirmation despite stale UI state");
  assert.equal(ready.dialogs[0].launchStatus, "active");
  for (const blocker of ["unsupported_locale", "audience_too_small", "selected_geo_unverified", "budget_pricing_required", "missing_scope:rw_ads"]) {
    const refused = launchHarness({ responses: [freshLaunchPreflight(["available_image_required", blocker])] });
    await refused.open();
    assert.equal(refused.dialogs.length, 0, blocker);
    assert.ok(refused.notices.includes(linkedInAdsLaunchBlockerMessage([blocker])), blocker);
  }
});

function assistedLaunchDraft(): Partial<AdsCampaignInput> {
  const endAt = new Date(Date.now() + 8 * 86_400_000).toISOString();
  return {
    creationMode: "inrcy",
    linkedinDeliverySettings: {
      ...defaultLinkedInDeliverySettings(),
      locationType: "permanent",
      professionalTargeting: {
        include: [
          { facet: "seniorities", urn: "urn:li:seniority:10", name: "Propriétaire" },
          { facet: "companySizes", urn: "urn:li:staffCountRange:(1,1)", name: "Moi uniquement" },
        ],
        exclude: [],
      },
      placements: { audienceNetwork: false, audienceExpansion: false },
      bidding: { strategy: "maximum_delivery", amountEuros: null },
      budget: { type: "total", totalEuros: 200, startAt: null, endAt },
    },
  };
}

test("AI direct validation without spending consent returns before any fetch", async () => {
  const harness = launchHarness({ initialDraft: assistedLaunchDraft() });
  await harness.open(true);
  assert.deepEqual(harness.requests, []);
  assert.deepEqual(harness.requestedDrafts, []);
  assert.deepEqual(harness.dialogs, []);
  assert.match(harness.notices.join(" "), /confirmation du budget/);
});

test("AI consent covers the full proposal, including copy and media beyond the preflight resource key", async () => {
  for (const patch of [{ primaryText: "Une autre offre à relire." }, { imageUrl: "https://example.com/other.jpg" }]) {
    const harness = launchHarness({ initialDraft: assistedLaunchDraft(), confirmedSpend: true });
    const draft = harness.currentDraft();
    const previouslyApproved = { ...draft, ...patch };
    assert.equal(linkedInAdsLaunchPreflightKey(previouslyApproved), linkedInAdsLaunchPreflightKey(draft));
    assert.ok(harness.consent.current);
    harness.consent.current.key = JSON.stringify(previouslyApproved);
    await harness.open(true);
    assert.deepEqual(harness.requests, []);
    assert.deepEqual(harness.dialogs, []);
  }
});

test("fresh LinkedIn defaults invalidate AI consent and never publish the updated proposal", async () => {
  const harness = launchHarness({
    initialDraft: { ...assistedLaunchDraft(), linkedinCampaignGroupId: undefined }, confirmedSpend: true,
  });
  await harness.open(true);
  assert.equal(harness.requestedDrafts.length, 2);
  assert.equal(harness.currentDraft().linkedinCampaignGroupId, launchGroup.id);
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 0);
  assert.deepEqual(harness.dialogs, []);
  assert.equal(harness.consentChecked(), false);
  assert.equal(harness.consent.current, null);
  assert.equal(harness.requests.some(({ url }) => url === "/api/ads/campaigns"), false);
  assert.match(harness.notices.join(" "), /réglages.*(?:changé|actualisés)/i);
});

test("a freshly discovered PAUSED status requires new AI consent even when the draft is unchanged", async () => {
  const paused = freshLaunchPreflight(["available_image_required", "account_not_serving"]);
  paused.account.canServeCampaigns = false;
  const harness = launchHarness({ initialDraft: assistedLaunchDraft(), confirmedSpend: true, responses: [paused] });
  await harness.open(true);
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 0);
  assert.deepEqual(harness.dialogs, []);
  assert.equal(harness.consentChecked(), false);
  assert.equal(harness.consent.current, null);
  assert.equal(harness.requests.some(({ url }) => url === "/api/ads/campaigns"), false);
});

test("stable AI consent publishes only after the fresh resource and publisher checks, with one exact native save", async () => {
  const harness = launchHarness({ initialDraft: assistedLaunchDraft(), confirmedSpend: true });
  const expected = harness.currentDraft();
  await harness.open(true);
  assert.deepEqual(harness.events, [
    "GET /api/ads/linkedin/accounts",
    "GET LinkedIn resources",
    "POST /api/ads/campaigns",
    "GET /api/ads/campaigns/saved-draft/preflight?mode=live",
    "POST /api/ads/campaigns/saved-draft/publish",
  ], harness.notices.join(" "));
  const saved = JSON.parse(harness.requests.find(({ url }) => url === "/api/ads/campaigns")?.body || "{}");
  assert.equal(saved.adAccountId, expected.adAccountId);
  assert.equal(saved.linkedinCampaignGroupId, expected.linkedinCampaignGroupId);
  assert.equal(saved.linkedinOrganizationUrn, expected.linkedinOrganizationUrn);
  assert.deepEqual(saved.linkedinGeoTargets, expected.linkedinGeoTargets);
  assert.deepEqual(saved.linkedinDeliverySettings, expected.linkedinDeliverySettings);
  assert.deepEqual(harness.currentDraft().linkedinDeliverySettings, expected.linkedinDeliverySettings);
  const published = JSON.parse(harness.requests.at(-1)?.body || "{}");
  assert.deepEqual(published, { mode: "live", confirmation: ADS_LIVE_PUBLISH_CONFIRMATION });
  assert.equal(harness.dialogs.length, 1);
  assert.equal((harness.dialogs[0] as { mode?: string }).mode, "success", "there is no second confirmation modal");
  assert.equal(harness.consentChecked(), false);
  assert.equal(harness.consent.current, null);
});

test("revoking AI consent during the asynchronous publisher check prevents publication", async () => {
  const harness = launchHarness({
    initialDraft: assistedLaunchDraft(), confirmedSpend: true, revokeConsentDuringPublisherCheck: true,
  });
  await harness.open(true);
  assert.ok(harness.requests.some(({ url }) => url.includes("/preflight?")));
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 0);
  assert.deepEqual(harness.dialogs, []);
  assert.equal(harness.consent.current, null);
});

test("a user edit during the resource check is preserved when AI publication is abandoned", async () => {
  const editedText = "Une modification personnelle à conserver et à relire.";
  const harness = launchHarness({
    initialDraft: assistedLaunchDraft(), confirmedSpend: true, editedTextDuringResourceCheck: editedText,
  });
  await harness.open(true);
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 0);
  assert.deepEqual(harness.dialogs, []);
  assert.equal(harness.currentDraft().primaryText, editedText, "the earlier launch snapshot must not overwrite the edit");
  assert.equal(harness.isDirty(), true, "the edited proposal has not been saved");
  assert.equal(harness.consent.current, null);
  assert.equal(harness.requests.some(({ url }) => url === "/api/ads/campaigns"), false);
});

test("a user edit made while saving is not overwritten by the earlier save response", async () => {
  const editedText = "Mon texte modifié pendant la sauvegarde du brouillon.";
  const harness = launchHarness({
    initialDraft: assistedLaunchDraft(), confirmedSpend: true, editedTextDuringSave: editedText,
  });
  await harness.open(true);
  assert.equal(harness.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 1);
  assert.equal(harness.requests.some(({ url }) => url.includes("/preflight?")), false);
  assert.equal(harness.requests.some(({ url }) => url.endsWith("/publish")), false);
  assert.deepEqual(harness.dialogs, []);
  assert.equal(harness.currentDraft().primaryText, editedText);
  assert.equal(harness.isDirty(), true);
  assert.equal(harness.consent.current, null);
});

test("manual LinkedIn launch keeps its confirmation modal and original save-then-publish flow", async () => {
  const harness = launchHarness();
  await harness.open();
  assert.equal(harness.dialogs.length, 1);
  assert.equal((harness.dialogs[0] as { mode?: string }).mode, "confirm");
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 0);
  await harness.confirm();
  assert.equal(harness.requests.filter(({ url }) => url === "/api/ads/campaigns").length, 2);
  assert.equal(harness.requests.filter(({ url }) => url.endsWith("/publish")).length, 1);
  assert.equal((harness.dialogs.at(-1) as { mode?: string }).mode, "success");
});

test("a provider CPC or resource default is applied and reread with the updated draft before confirmation", async () => {
  const harness = launchHarness({ initialDraft: { linkedinBidEuros: undefined, linkedinGeoTargets: [], linkedinCampaignGroupId: undefined, linkedinOrganizationUrn: undefined } });
  await harness.open();
  assert.equal(harness.requestedDrafts.length, 2);
  assert.equal(harness.requestedDrafts[0].linkedinBidEuros, undefined);
  assert.equal(harness.requestedDrafts[1].linkedinBidEuros, 2);
  assert.equal(harness.requestedDrafts[1].linkedinCampaignGroupId, launchGroup.id);
  assert.equal(harness.requestedDrafts[1].linkedinOrganizationUrn, launchOrganization.urn);
  assert.deepEqual(harness.requestedDrafts[1].linkedinGeoTargets, [{ urn: launchGeo.urn, name: launchGeo.name }]);
  assert.equal(harness.currentDraft().linkedinBidEuros, 2);
  assert.equal(harness.dialogs.length, 1, harness.notices.join(" "));

  const refused = launchHarness({ initialDraft: { linkedinBidEuros: undefined }, responses: [freshLaunchPreflight(), freshLaunchPreflight(["audience_count_required"])] });
  await refused.open();
  assert.equal(refused.requestedDrafts.length, 2);
  assert.equal(refused.dialogs.length, 0, "the second response supersedes a successful earlier check");
});

test("PAUSED confirmation accepts only the stage-specific exceptions and still rejects other fresh blockers", async () => {
  const paused = freshLaunchPreflight(["available_image_required", "account_not_serving", "campaign_group_not_active"]);
  paused.account.canServeCampaigns = false;
  paused.campaignGroups = [{ ...launchGroup, status: "PAUSED" }];
  paused.selected.campaignGroup = paused.campaignGroups[0];
  const harness = launchHarness({ responses: [paused] });
  await harness.open();
  assert.equal(harness.dialogs.length, 1, harness.notices.join(" "));
  assert.equal(harness.dialogs[0].launchStatus, "paused");
  const refused = launchHarness({ responses: [{ ...paused, blockers: [...paused.blockers, "daily_budget_too_low"] }] });
  await refused.open();
  assert.equal(refused.dialogs.length, 0);

  const scope = gateScope("linkedin", true, true);
  scope.linkedInPreflight = { account: { canServeCampaigns: true, canManageCampaigns: true }, blockers: ["available_image_required"] };
  assert.equal(dialogGate("activeEnabled", scope), true);
  assert.equal(dialogGate("pausedEnabled", scope), true);
  scope.linkedInPreflight = { account: { canServeCampaigns: true, canManageCampaigns: true }, blockers: ["unsupported_locale"] };
  assert.equal(dialogGate("activeEnabled", scope), false);
  assert.equal(dialogGate("pausedEnabled", scope), false);
});

test("the actual preflight request serializes the effective draft rather than the earlier React closure", async () => {
  const draft = launchHarness().currentDraft();
  const effective = {
    ...draft, targetLocations: ["Lille"], dailyBudgetEuros: 40, linkedinBidEuros: 3.5,
    linkedinGeoTargets: [{ urn: "urn:li:geo:100323840", name: "Lille, Hauts-de-France, France" }],
    linkedinCampaignGroupId: "678", linkedinOrganizationUrn: "urn:li:organization:999",
  };
  let requestedUrl = "";
  const fetchPreflight = actualFunction("fetchLinkedInPreflight", {
    draft, externalStatuses: { linkedin: { selectedAccountId: "123" } },
    linkedInPreflightContext: { current: 0 },
    linkedInPreflightCache: { current: new Map() },
    setLinkedInPreflight: () => {}, buildLinkedInGeoQueries, linkedInGeoQueryKey,
    fetch: async (url: string) => { requestedUrl = url; return freshLaunchPreflight(); },
    readJson: async (value: unknown) => value,
  });
  await fetchPreflight(undefined, true, "123", effective);
  const params = new URL(requestedUrl, "https://example.com").searchParams;
  assert.deepEqual(params.getAll("geo"), ["Lille"]);
  assert.deepEqual(params.getAll("geoUrn"), ["urn:li:geo:100323840"]);
  assert.equal(params.get("campaignGroupId"), "678");
  assert.equal(params.get("organizationUrn"), "urn:li:organization:999");
  assert.equal(params.get("bidAmount"), "3.50");
  assert.equal(params.get("dailyBudget"), "40.00");
});

test("confirmation saves the effective draft and checks publisher evidence without calling publish", async () => {
  const harness = launchHarness({ initialDraft: { linkedinBidEuros: undefined }, savedId: "existing-draft" });
  await harness.open();
  assert.equal(harness.dialogs.length, 1, harness.notices.join(" "));
  assert.deepEqual(harness.requests.map(({ url, method }) => ({ url, method })), [
    { url: "/api/ads/linkedin/accounts", method: "GET" },
    { url: "/api/ads/campaigns", method: "POST" },
    { url: "/api/ads/campaigns/saved-draft/preflight?mode=live", method: "GET" },
  ]);
  const savedDraft = JSON.parse(harness.requests[1].body || "{}");
  assert.equal(savedDraft.id, "existing-draft");
  assert.equal(savedDraft.linkedinBidEuros, 2);
  assert.equal(savedDraft.adAccountId, "12345");
  assert.deepEqual(savedDraft.linkedinGeoTargets, [{ urn: launchGeo.urn, name: launchGeo.name }]);
  assert.equal(harness.currentSavedId(), "saved-draft");
});

test("an incomplete publisher check keeps the draft but never opens paid-launch confirmation", async () => {
  for (const publicationCheck of [
    {}, { ready: false, verifiedGeoCount: 1 }, { ready: true, verifiedGeoCount: 0 }, { ready: true, verifiedGeoCount: 2 },
  ]) {
    const harness = launchHarness({ publicationCheck });
    await harness.open();
    assert.equal(harness.dialogs.length, 0);
    assert.equal(harness.currentSavedId(), "saved-draft");
    assert.match(harness.notices.join(" "), /brouillon est conservé/);
  }
  const paused = freshLaunchPreflight(["account_not_serving", "available_image_required"]);
  paused.account.canServeCampaigns = false;
  const harness = launchHarness({ responses: [paused] });
  await harness.open();
  assert.equal(harness.requests.at(-1)?.url, "/api/ads/campaigns/saved-draft/preflight?mode=paused");
});


test("a stale website-visit default cannot attach its group after the objective changes", () => {
  const base = launchHarness({ initialDraft: { linkedinCampaignGroupId: undefined, linkedinBidEuros: undefined } }).currentDraft();
  let current = { ...base, channelSettings: { ...base.channelSettings, objectiveType: "WEBSITE_CONVERSION" } } as AdsCampaignInput;
  const expected = current;
  const apply = actualFunction("applyLinkedInProviderDefaults", {
    draft: base, externalStatuses: { linkedin: { selectedAccountId: "12345" } },
    linkedInGeoDismissedUrns: { current: new Set<string>() },
    normalizeLinkedInGeoTargets, linkedInAdsContextualGeoDefaults, linkedInAdsAutomaticPreflightKey, linkedInAdsVerifiedBidDefault,
    linkedInCampaignGroupIsCompatible: actualFunction("linkedInCampaignGroupIsCompatible", {}),
    applyDraftEdit: actualFunction("applyDraftEdit", {}),
    setDraft: (updater: (value: AdsCampaignInput) => AdsCampaignInput) => { current = updater(current); },
    setDirty: () => {}, setConfirmedSpend: () => {},
    linkedInLaunchConsent: { current: null },
  });
  apply(freshLaunchPreflight(), base);
  assert.equal(current, expected);
  assert.equal(current.linkedinCampaignGroupId, undefined);
  assert.equal(current.linkedinBidEuros, undefined);
});
