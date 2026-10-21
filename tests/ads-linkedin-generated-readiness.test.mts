import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { linkedInCalendarIssue, prepareLinkedInPlanForGroup } from "../lib/adsLinkedInCalendarReadiness.ts";
import { linkedInAdsAutomaticPreflightKey, linkedInAdsContextualGeoDefaults, linkedInAdsVerifiedBidDefault } from "../lib/adsLinkedInClientDefaults.ts";
import { normalizeLinkedInGeoTargets } from "../lib/adsValidation.ts";
import { buildLinkedInGeoQueries, linkedInGeoQueryKey } from "../lib/adsLinkedInGeoQueries.ts";
import { defaultLinkedInDeliverySettings } from "../lib/adsLinkedInCampaignSettings.ts";
import { readLinkedInHumanDeliveryConstraints } from "../lib/adsLinkedInPlanDelivery.ts";
import { adsRequestedDurationDays } from "../lib/adsBudgetRecommendation.ts";
import type { AdsCampaignInput } from "../lib/adsValidation.ts";
import type { LinkedInAdsCampaignGroup } from "../lib/adsLinkedInPreflightPolicy.ts";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("AdsClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualFunction(name: string, scope: Record<string, unknown>) {
  let node: ts.FunctionDeclaration | undefined;
  function visit(candidate: ts.Node) { if (ts.isFunctionDeclaration(candidate) && candidate.name?.text === name) node = candidate; ts.forEachChild(candidate, visit); }
  visit(source); assert.ok(node, name);
  const code = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), `${code}; return ${name};`)(...Object.values(scope));
}
const nowMs = Date.parse("2026-10-12T09:00:00Z");
function draft(patch: Partial<AdsCampaignInput> = {}): AdsCampaignInput {
  return { provider: "linkedin", creationMode: "inrcy", adAccountId: "123", accountCurrency: "EUR", name: "Campagne test",
    targetLocations: ["Lille"], linkedinGeoTargets: [], dailyBudgetEuros: 10, endDate: "2026-11-10",
    linkedinCampaignGroupId: "456", linkedinOrganizationUrn: "urn:li:organization:789",
    channelSettings: { schemaVersion: 1, channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", targetingFacet: "titles", locale: { language: "fr", country: "FR" } },
    linkedinDeliverySettings: { ...defaultLinkedInDeliverySettings(), bidding: { strategy: "maximum_delivery", amountEuros: null }, budget: { type: "daily", totalEuros: null, startAt: null, endAt: "2026-11-10T22:37:03Z" } },
    ...patch } as AdsCampaignInput;
}
function group(id = "456", patch: Partial<LinkedInAdsCampaignGroup> = {}): LinkedInAdsCampaignGroup {
  return { id, urn: `urn:li:sponsoredCampaignGroup:${id}`, account: "urn:li:sponsoredAccount:123", name: "Octobre",
    status: "ACTIVE", objectiveType: "WEBSITE_VISIT", allowedCampaignTypes: ["SPONSORED_UPDATES"],
    organizationUrn: "urn:li:organization:789", runSchedule: { start: Date.parse("2026-10-01T00:00:00Z"), end: Date.parse("2026-11-01T00:00:00Z") }, ...patch };
}

test("a generated November campaign uses a verified compatible group instead of keeping the previous October default", () => {
  const initial = draft(), october = group(), open = group("999", { runSchedule: {} });
  const ready = prepareLinkedInPlanForGroup(initial, { groups: [october, open], manualGroupId: null, endIsExplicit: true, nowMs });
  assert.equal(ready.linkedinCampaignGroupId, "999");
  assert.equal(ready.linkedinDeliverySettings?.budget.endAt, initial.linkedinDeliverySettings?.budget.endAt);
  assert.equal(linkedInCalendarIssue(ready, open, nowMs), "");
});
test("when only October is available, the default AI end fits that group without changing budget, start, audience or message", () => {
  const initial = draft(), october = group();
  const ready = prepareLinkedInPlanForGroup(initial, { groups: [october], manualGroupId: null, endIsExplicit: false, nowMs });
  assert.equal(ready.linkedinCampaignGroupId, october.id);
  assert.equal(Date.parse(ready.linkedinDeliverySettings!.budget.endAt!), october.runSchedule.end! - 1_000);
  assert.equal(ready.dailyBudgetEuros, initial.dailyBudgetEuros);
  assert.equal(ready.linkedinDeliverySettings?.budget.startAt, initial.linkedinDeliverySettings?.budget.startAt);
  assert.deepEqual(ready.linkedinDeliverySettings?.professionalTargeting, initial.linkedinDeliverySettings?.professionalTargeting);
  assert.equal(linkedInCalendarIssue(ready, october, nowMs), "");
  assert.equal(initial.linkedinDeliverySettings?.budget.endAt, "2026-11-10T22:37:03Z", "input is never mutated");
});
test("an explicit human date, selected group, amount and incompatible objective are never silently replaced", () => {
  const initial = draft(), october = group(), open = group("999", { runSchedule: {} });
  const explicit = prepareLinkedInPlanForGroup(initial, { groups: [october, open], manualGroupId: "456", endIsExplicit: true, nowMs });
  assert.equal(explicit, initial);
  assert.match(linkedInCalendarIssue(explicit, october, nowMs), /période du groupe/);
  const noMatch = prepareLinkedInPlanForGroup(initial, { groups: [group("999", { objectiveType: "LEAD_GENERATION" })], manualGroupId: null, endIsExplicit: false, nowMs });
  assert.equal(noMatch.linkedinCampaignGroupId, "");
  assert.equal(noMatch.linkedinDeliverySettings?.budget.endAt, initial.linkedinDeliverySettings?.budget.endAt);
});
test("expired groups and past or >90-day calendars remain blocked", () => {
  const expired = group("456", { runSchedule: { end: nowMs - 1_000 } });
  assert.equal(prepareLinkedInPlanForGroup(draft(), { groups: [expired], manualGroupId: null, endIsExplicit: false, nowMs }).linkedinCampaignGroupId, "");
  const past = draft(); past.linkedinDeliverySettings!.budget.startAt = "2026-10-01T09:00:00Z";
  assert.match(linkedInCalendarIssue(past, group(), nowMs), /début est passée/);
  const far = draft(); far.linkedinDeliverySettings!.budget.endAt = "2027-12-01T09:00:00Z";
  assert.match(linkedInCalendarIssue(far, group("999", { runSchedule: {} }), nowMs), /90 jours/);
});

function preflightHarness(initial = draft()) {
  const calls: string[] = [], responses: unknown[] = [];
  const signature = { current: linkedInAdsAutomaticPreflightKey("123", initial) };
  const scope = { draft: initial, externalStatuses: { linkedin: { selectedAccountId: "123" } },
    linkedInPreflightContext: { current: 0 }, linkedInLatestPreflightSignature: signature,
    linkedInPreflightCache: { current: new Map() }, linkedInAdsAutomaticPreflightKey, buildLinkedInGeoQueries, linkedInGeoQueryKey,
    setLinkedInPreflight: (update: (previous: unknown) => unknown) => responses.push(update(responses.at(-1))),
    readJson: async (value: unknown) => value,
    fetch: async (url: string) => { calls.push(url); const params = new URL(url, "https://test.example").searchParams;
      return { blockers: [params.get("politicalIntentConfirmed") !== "true" ? "political_intent_confirmation_required" : null,
        params.get("targetingNoticeAcknowledged") !== "true" ? "targeting_notice_acknowledgement_required" : null].filter(Boolean), geoResolutions: [] }; },
  };
  return { scope, signature, calls, responses, fetch: () => actualFunction("fetchLinkedInPreflight", scope) };
}
test("checking the visible declarations performs a fresh preflight with true flags and clears the former missing-confirmation result", async () => {
  const h = preflightHarness();
  await h.fetch()(undefined, false);
  assert.equal((h.responses.at(-1) as { blockers: string[] }).blockers.length, 2);
  const checked = draft({ linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true });
  h.scope.draft = checked; h.signature.current = linkedInAdsAutomaticPreflightKey("123", checked);
  await h.fetch()(undefined, false);
  assert.equal(h.calls.length, 2, "unchecked result cannot be reused from the cache");
  assert.deepEqual((h.responses.at(-1) as { blockers: string[] }).blockers, []);
  assert.equal((h.responses.at(-1) as { inputKey: string }).inputKey, h.signature.current);
});
test("a slower unchecked preflight response cannot overwrite the newer checked result", async () => {
  const h = preflightHarness(); let resolveOld!: (value: unknown) => void;
  h.scope.fetch = async () => new Promise<{ blockers: (string | null)[]; geoResolutions: never[] }>((resolve) => { resolveOld = (value) => resolve(value as { blockers: (string | null)[]; geoResolutions: never[] }); });
  const old = h.fetch()(undefined, false);
  const checked = draft({ linkedinPoliticalIntentConfirmed: true, linkedinTargetingNoticeAcknowledged: true });
  h.signature.current = linkedInAdsAutomaticPreflightKey("123", checked);
  h.scope.draft = checked; h.scope.fetch = async () => ({ blockers: [], geoResolutions: [] });
  await h.fetch()(undefined, false);
  resolveOld({ blockers: ["targeting_notice_acknowledgement_required"], geoResolutions: [] });
  await old;
  assert.equal(h.responses.length, 1);
  assert.deepEqual((h.responses[0] as { blockers: string[] }).blockers, []);
});
test("failure of an older preflight cannot mark a changed campaign as failed", async () => {
  const states: string[] = [], errors: string[] = [];
  let rejectOld!: (error: Error) => void;
  const signature = { current: "old" };
  const scope = { linkedInPreflightLoad: "ready", linkedInPreflightContext: { current: 0 }, linkedInLatestPreflightSignature: signature,
    setLinkedInPreflightLoad: (value: string) => states.push(value), setLinkedInPreflightError: (value: string) => { if (value) errors.push(value); },
    fetchLinkedInPreflight: () => new Promise((_resolve, reject) => { rejectOld = reject; }), applyLinkedInProviderDefaults: () => { throw new Error("stale response cannot apply defaults"); },
  };
  const pending = actualFunction("loadLinkedInResources", scope)();
  signature.current = "checked"; rejectOld(new Error("old failed request")); await pending;
  assert.deepEqual(states, ["loading", "idle"]);
  assert.deepEqual(errors, []);
});
test("the real plan application reconciles the group with the generated calendar before automatic preflight", () => {
  let current = draft();
  const noop = () => {};
  const scope = { channelId: "linkedin", linkedInPreflightContext: { current: 0 }, linkedInAutomaticLoadKey: { current: "old" },
    linkedInPlanEndIsExplicit: { current: true },
    linkedInPreflight: { campaignGroups: [group(), group("999", { runSchedule: {} })] }, linkedInManualGroupId: { current: null },
    setLinkedInPreflight: noop, setLinkedInPreflightLoad: noop, setLinkedInAudienceSuggestions: noop, setLinkedInAudiencePending: noop,
    setConfirmedDestinationUrl: noop, setMetaMediaFormatStatus: noop, setDraft: (update: (previous: AdsCampaignInput) => AdsCampaignInput) => { current = update(current); },
    adsChannelWizardSettingsFromBrief: () => current.channelSettings, nativeBriefCopy: () => ({ message: "Message", media: "Image", headline: "Titre", destination: "https://example.com" }),
    defaultLinkedInDeliverySettings, linkedInCallToActionFromLabel: () => "LEARN_MORE", prepareLinkedInPlanForGroup: (value: AdsCampaignInput, options: Parameters<typeof prepareLinkedInPlanForGroup>[1]) => prepareLinkedInPlanForGroup(value, { ...options, nowMs }),
    nativeWizardGenericObjective: () => "traffic", nativeWizardMediaStrategy: () => "image",
    linkedInGeoDismissedUrns: { current: new Set() }, linkedInGeoChoices: { current: {} }, setLinkedInGeoQuery: noop, setDirty: noop,
    setConfirmedSpend: noop, linkedInLaunchConsent: { current: null },
  };
  actualFunction("applyCampaignPlan", scope)({ channelDraft: { channel: "linkedin", name: "Plan", budget: { amount: 10, period: "daily" }, audience: { locationBriefs: ["Lille"], audienceBrief: "Dirigeants" } }, linkedinCalendarConstraints: { endIsExplicit: true },
    linkedinDeliverySuggestion: { budget: { startAt: null, endAt: "2026-11-10T22:37:03Z" } }, name: "Plan", primaryText: "Message", targetLocations: ["Lille"], headlines: ["Titre"], descriptions: ["Description"], keywords: [] });
  assert.equal(current.linkedinCampaignGroupId, "999");
  assert.equal(current.linkedinDeliverySettings?.budget.endAt, "2026-11-10T22:37:03Z");
});
test("groups arriving after generation still adapt the default calendar through the actual provider-defaults handler", () => {
  let current = draft({ linkedinCampaignGroupId: "" });
  const prepare = (value: AdsCampaignInput, options: Parameters<typeof prepareLinkedInPlanForGroup>[1]) => prepareLinkedInPlanForGroup(value, { ...options, nowMs });
  const scope = { draft: current, externalStatuses: { linkedin: { selectedAccountId: "123" } },
    prepareLinkedInPlanForGroup: prepare, linkedInManualGroupId: { current: null }, linkedInPlanEndIsExplicit: { current: false },
    linkedInGeoDismissedUrns: { current: new Set() }, linkedInAdsAutomaticPreflightKey, normalizeLinkedInGeoTargets,
    linkedInAdsContextualGeoDefaults, linkedInAdsVerifiedBidDefault, linkedInCampaignGroupIsCompatible: () => true,
    applyDraftEdit: actualFunction("applyDraftEdit", {}),
    setDraft: (update: (previous: AdsCampaignInput) => AdsCampaignInput) => { current = update(current); },
    setDirty: () => {}, setConfirmedSpend: () => {}, linkedInLaunchConsent: { current: null },
  };
  actualFunction("applyLinkedInProviderDefaults", scope)({ selected: { campaignGroup: null }, campaignGroups: [group()] });
  assert.equal(current.linkedinCampaignGroupId, "456");
  assert.equal(linkedInCalendarIssue(current, group(), nowMs), "");
  assert.equal(current.dailyBudgetEuros, 10);
});
test("server-owned calendar provenance protects explicit end dates and campaign durations, while a 21-day free-trial offer is not a campaign deadline", () => {
  const routeText = readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8");
  const route = ts.createSourceFile("route.ts", routeText, ts.ScriptTarget.Latest, true);
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(route) === "endIsExplicit") expression = node.initializer; ts.forEachChild(node, visit); }
  visit(route); assert.ok(expression);
  const evaluateExpression = new Function("humanDelivery", "professionalIntent", "adsRequestedDurationDays", `return (${expression.getText(route)});`);
  const evaluate = (humanDelivery: unknown, professionalIntent: string) => evaluateExpression(humanDelivery, professionalIntent, adsRequestedDurationDays);
  for (const [intent, expected] of [
    ["Faire connaître notre essai gratuit de 21 jours sans engagement.", false],
    ["Diffuser la campagne pendant 21 jours avec un budget de 10 € par jour.", true],
    ["Diffuser la campagne sur 3 semaines.", true],
    ["Diffuser du 20 octobre 2026 au 10 novembre 2026 en heure de Paris.", true],
    ["Diffuser jusqu'au 2026-11-10T22:00:00Z.", true],
  ] as const) {
    const constraints = readLinkedInHumanDeliveryConstraints({ intent, now: "2026-10-12T09:00:00Z", timezone: "Europe/Paris" });
    assert.equal(evaluate(constraints, intent), expected, intent);
  }
});
