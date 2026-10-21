import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { adsRequestedDurationDays, normalizeAdsBudgetRecommendation } from "../lib/adsBudgetRecommendation.ts";
import { normalizeAdsCampaignPlan, assessAdsCampaignPlanReview, adsCampaignPlanValidationIssueCodes, isReviewableAdsCampaignPlan, type AdsCampaignPlan } from "../lib/adsCampaignPlan.ts";
import { adsPlanRepairDetails, canRepairAdsPlanQuality } from "../lib/adsPlanQuality.ts";
import { isPlannedAdsChannel } from "../lib/adsChannelCapabilities.ts";
import { selectOpenaiAdsPlanLocations } from "../lib/adsOpenaiPlanIntent.ts";
import { defaultLinkedInDeliverySettings } from "../lib/adsLinkedInCampaignSettings.ts";
import { defaultGoogleDeliverySettings } from "../lib/adsGoogleCampaignSettings.ts";
import { defaultMetaDeliverySettings, META_CALL_TO_ACTION_LABELS } from "../lib/adsMetaCampaignSettings.ts";
import { defaultPinterestDeliverySettings } from "../lib/adsPinterestCampaignSettings.ts";
import { defaultOpenaiDeliverySettings } from "../lib/adsOpenaiCampaignSettings.ts";
import { defaultPreparedDeliverySettings } from "../lib/adsPreparedCampaignSettings.ts";
import { adsChannelWizardSettingsFromBrief } from "../lib/adsChannelWizardSettings.ts";
import type { AdsCampaignInput, AdsChannelId } from "../lib/adsValidation.ts";

const now = "2026-10-21T12:00:00.000Z", day = 86_400_000;
const rationale = "Un premier test concentré sur l’offre et les villes connues laisse le temps de comparer les messages. Le budget reste à ajuster après observation des résultats réels.";
const context = { companyName: "Atelier Exemple", destinationUrl: "https://atelier.example/offre", locations: ["Lille"], locationsAreSelected: true, country: "FR", services: ["Accompagnement professionnel"], now, timezone: "Europe/Paris" };
function response(provider: AdsChannelId, dailyEuros = 22.5, durationDays = 14): Record<string, unknown> {
  const creative = {
    linkedin: { introText: "Découvrez notre accompagnement professionnel pour vos projets.", headline: "Votre projet accompagné", mediaBrief: "Une démonstration fidèle du service, à créer.", destinationUrl: context.destinationUrl },
    pinterest: { pinTitle: "Votre projet accompagné", pinDescription: "Découvrez notre accompagnement pour préparer votre projet professionnel.", visualBrief: "Une image portrait fidèle à l’offre, à créer.", destinationUrl: context.destinationUrl },
    tiktok: { adText: "Découvrez notre accompagnement pour votre projet", videoBrief: "Une démonstration vidéo fidèle à l’offre, à créer.", destinationUrl: context.destinationUrl },
    x: { postText: "Découvrez notre accompagnement professionnel pour votre projet.", mediaBrief: "Une image fidèle au service, à créer.", destinationUrl: context.destinationUrl },
  };
  const native = provider === "linkedin" ? { objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", locale: { country: "FR", language: "fr" } }
    : provider === "pinterest" ? { objectiveType: "CONSIDERATION", intendedPromotionType: "STANDARD_AD", targetingMode: "automatic", creativeType: "REGULAR", conversionEvent: null }
      : provider === "tiktok" ? { objectiveType: "TRAFFIC", format: "video", destinationKind: "website", placementIntent: "tiktok_only", optimizationIntent: "clicks" }
        : { objective: "website_traffic", format: "image", targetingMode: "broad", keywords: [] };
  return {
    brand: "Atelier Exemple", name: "Votre projet à Lille", offer: "Accompagnement professionnel",
    rationale: "L’offre accompagne les projets des professionnels de Lille. Une présentation concrète invite à consulter la page du service ; le suivi des visites reste à vérifier.",
    budgetRecommendation: { dailyEuros, durationDays, rationale },
    campaignType: provider === "google" ? "search" : provider === "meta" ? "meta_traffic" : "generic", objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "maximize_clicks",
    primaryText: "Découvrez notre accompagnement professionnel pour préparer votre projet.", headlines: ["Votre projet accompagné"], descriptions: ["Découvrez notre accompagnement pour préparer votre projet."], callToAction: "En savoir plus",
    targetLocations: ["Lille"], targetAudiences: ["Professionnels préparant un projet"], languages: ["fr"], keywords: [], negativeKeywords: [], mediaStrategy: provider === "google" ? "search_text" : "image", creativeType: "image", mediaBrief: "Une présentation fidèle du service, à créer.", metaPlacements: ["facebook_feed"],
    ...(isPlannedAdsChannel(provider) ? { channelDraft: { schemaVersion: 1, channel: provider, name: "Votre projet à Lille", budget: { amount: 10, currency: "EUR", period: "daily", level: "campaign" }, audience: { locationBriefs: ["Lille"], audienceBrief: "Professionnels préparant un projet" }, ...native, creative: creative[provider] } } : {}),
  };
}
function budgetOf(plan: AdsCampaignPlan, provider: AdsChannelId) {
  if (provider === "linkedin") return { daily: plan.channelDraft?.budget.amount, total: plan.linkedinBudgetSuggestion?.totalEuros, type: plan.linkedinBudgetSuggestion?.type, start: plan.linkedinDeliverySuggestion?.budget.startAt, end: plan.linkedinDeliverySuggestion?.budget.endAt };
  if (provider === "google") return { daily: plan.googleBudgetSuggestion?.dailyEuros, total: plan.googleBudgetSuggestion?.totalEuros, type: plan.googleBudgetSuggestion?.type, start: plan.googleBudgetSuggestion?.startDate, end: plan.googleBudgetSuggestion?.endDate };
  const budget = provider === "meta" ? plan.metaBudgetSuggestion : provider === "pinterest" ? plan.pinterestBudgetSuggestion : provider === "openai" ? plan.openaiBudgetSuggestion : plan.preparedBudgetSuggestion;
  return { daily: budget?.dailyEuros, total: budget?.totalEuros, type: budget?.type, start: budget?.startAt, end: budget?.endAt };
}
function durationOf(plan: AdsCampaignPlan, provider: AdsChannelId) {
  const budget = budgetOf(plan, provider);
  return provider === "google" ? (Date.parse(budget.end! + "T00:00:00Z") - Date.parse(budget.start! + "T00:00:00Z")) / day + 1
    : (Date.parse(budget.end!) - Date.parse(budget.start || now)) / day;
}

const client = ts.createSourceFile("AdsClient.tsx", readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function functionFrom(source: ts.SourceFile, name: string, scope: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(declaration);
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), compiled + `\nreturn ${name};`)(...Object.values(scope));
}
function apply(plan: AdsCampaignPlan, provider: AdsChannelId): AdsCampaignInput {
  let draft = { provider, dailyBudgetEuros: provider === "openai" ? 15 : 10, endDate: "2026-10-28", primaryText: "", keywords: [], headlines: [], descriptions: [] } as unknown as AdsCampaignInput;
  const noop = () => {};
  const scope = {
    channelId: provider, linkedInPreflightContext: { current: 0 }, linkedInPlanEndIsExplicit: { current: true }, linkedInAutomaticLoadKey: { current: "" }, linkedInPreflight: null, linkedInManualGroupId: { current: null },
    linkedInGeoDismissedUrns: { current: new Set() }, linkedInGeoChoices: { current: {} }, linkedInLaunchConsent: { current: null },
    setLinkedInPreflight: noop, setLinkedInPreflightLoad: noop, setLinkedInAudienceSuggestions: noop, setLinkedInAudiencePending: noop, setLinkedInGeoQuery: noop, setConfirmedDestinationUrl: noop, setMetaMediaFormatStatus: noop, setDirty: noop, setConfirmedSpend: noop,
    setDraft: (update: (current: AdsCampaignInput) => AdsCampaignInput) => { draft = update(draft); },
    adsChannelWizardSettingsFromBrief, defaultLinkedInDeliverySettings, defaultGoogleDeliverySettings, defaultMetaDeliverySettings, defaultOpenaiDeliverySettings, defaultPinterestDeliverySettings, defaultPreparedDeliverySettings, META_CALL_TO_ACTION_LABELS,
    nativeBriefCopy: () => ({ message: plan.primaryText, media: plan.mediaBrief, headline: plan.headlines[0], destination: plan.destinationUrl }), nativeWizardGenericObjective: () => "website_traffic", nativeWizardMediaStrategy: () => "image", linkedInCallToActionFromLabel: () => "LEARN_MORE", prepareLinkedInPlanForGroup: (value: AdsCampaignInput) => value,
  };
  functionFrom(client, "applyCampaignPlan", scope)(plan); return draft;
}

for (const provider of ["google", "meta", "linkedin", "pinterest", "openai", "tiktok", "x"] as const) {
  test(`${provider}: different justified AI budgets and periods reach the real wizard instead of 10 EUR and seven days`, () => {
    for (const [daily, days] of [[22.5, 14], [36, 21]]) {
      const plan = normalizeAdsCampaignPlan(response(provider, daily, days), { ...context, provider });
      assert.equal(budgetOf(plan, provider).daily, daily);
      assert.equal(durationOf(plan, provider), days);
      const draft = apply(plan, provider);
      assert.equal(draft.dailyBudgetEuros, daily);
      assert.equal(draft.endDate, provider === "google" ? plan.googleBudgetSuggestion!.endDate : new Date(Date.parse(budgetOf(plan, provider).end!)).toLocaleDateString("sv-SE"));
      assert.equal(plan.budgetRecommendation?.rationale, rationale);
    }
  });
  test(`${provider}: human daily limits, total envelopes and explicit durations win over the AI proposal`, () => {
    const daily = normalizeAdsCampaignPlan(response(provider, 60, 21), { ...context, provider, intent: "Campagne avec un budget de 37 euros par jour pendant deux semaines." });
    assert.equal(budgetOf(daily, provider).daily, 37);
    assert.equal(durationOf(daily, provider), 14);
    assert.equal(apply(daily, provider).dailyBudgetEuros, 37);
    const total = normalizeAdsCampaignPlan(response(provider, 60, 21), { ...context, provider, intent: "Campagne avec un budget total de 126 euros sur 14 jours." });
    assert.equal(budgetOf(total, provider).type, "total");
    assert.equal(budgetOf(total, provider).total, 126);
    assert.equal(durationOf(total, provider), 14);
    const draft = apply(total, provider);
    const native = provider === "google" ? draft.googleDeliverySettings : provider === "meta" ? draft.metaDeliverySettings : provider === "linkedin" ? draft.linkedinDeliverySettings : provider === "pinterest" ? draft.pinterestDeliverySettings : provider === "openai" ? draft.openaiDeliverySettings : draft.preparedDeliverySettings;
    assert.equal(native?.budget.type, "total");
    assert.equal(native?.budget.totalEuros, 126);
    assert.notEqual(draft.dailyBudgetEuros, 126, "an envelope must never become a daily charge");
  });
}

test("unjustified or out-of-range model budgets cannot become accepted recommendations", () => {
  const valid = { dailyEuros: 25, durationDays: 14, rationale };
  for (const patch of [{ dailyEuros: 50000 }, { dailyEuros: 0 }, { dailyEuros: 20.123 }, { dailyEuros: "25" }, { durationDays: 0 }, { durationDays: 91 }, { durationDays: 1.5 }, { rationale: "Au hasard" }]) assert.equal(normalizeAdsBudgetRecommendation({ ...valid, ...patch }, "meta"), null);
  assert.equal(normalizeAdsBudgetRecommendation({ ...valid, dailyEuros: 10 }, "openai"), null);
  assert.deepEqual(normalizeAdsBudgetRecommendation(valid, "meta"), valid);
});

test("durations concern campaign delivery, with negations and commercial trial periods kept separate", () => {
  assert.deepEqual(adsRequestedDurationDays("Notre offre : essai gratuit pendant 21 jours."), { days: null, error: null });
  assert.deepEqual(adsRequestedDurationDays("Campagne pendant une semaine."), { days: 7, error: null });
  assert.deepEqual(adsRequestedDurationDays("Campagne pendant deux semaines."), { days: 14, error: null });
  assert.deepEqual(adsRequestedDurationDays("Campagne, pas pendant 7 jours."), { days: null, error: null });
  assert.ok(adsRequestedDurationDays("Campagne pendant 7 jours et diffusion pendant 14 jours.").error);
});

test("fresh plan validation repairs a missing budget explanation instead of delivering legacy defaults", () => {
  const route = ts.createSourceFile("route.ts", readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  let validate: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => { if (ts.isPropertyAssignment(node) && node.name.getText(route) === "validate" && ts.isArrowFunction(node.initializer)) validate = node.initializer; ts.forEachChild(node, visit); };
  visit(route); assert.ok(validate);
  const code = ts.transpileModule(`const validate=${validate.getText(route)}; return {plan:validate(raw,"fixture"),issues:previousQualityIssues};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const scope = { provider: "meta", context: { zones: ["Lille"], localContext: {} }, resolvedDestination: { url: context.destinationUrl }, trustedBusinessCountry: "FR", professionalIntent: "", companyName: context.companyName, locationsAreSelected: true, now, timezone: context.timezone,
    stage: "generation", previousQualityIssues: [], previousQualityDetails: "", requestId: "fixture-request", console: { info() {}, warn() {} }, normalizeAdsCampaignPlan, assessAdsCampaignPlanReview, adsCampaignPlanValidationIssueCodes, adsPlanRepairDetails, isPlannedAdsChannel, selectOpenaiAdsPlanLocations, planIsReadyForReview: isReviewableAdsCampaignPlan };
  const run = (raw: Record<string, unknown>) => new Function(...Object.keys(scope), "raw", code)(...Object.values(scope), raw);
  const missing = response("meta"); delete missing.budgetRecommendation;
  const rejected = run(missing);
  assert.equal(rejected.plan, null);
  assert.ok(rejected.issues.includes("missing_budget_recommendation"));
  assert.equal(canRepairAdsPlanQuality(rejected.issues, 60_000), true);
  const accepted = run(response("meta"));
  assert.ok(accepted.plan);
  assert.equal(accepted.plan.metaBudgetSuggestion.dailyEuros, 22.5);
  assert.equal(accepted.plan.budgetRecommendation.durationDays, 14);
});
