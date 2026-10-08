import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as plans from "../lib/adsCampaignPlan.ts";
import * as intent from "../lib/adsLinkedInPlanIntent.ts";
import * as delivery from "../lib/adsLinkedInPlanDelivery.ts";
import * as intelligence from "../lib/adsCampaignIntelligence.ts";
import * as capabilities from "../lib/adsChannelCapabilities.ts";
import * as validation from "../lib/adsValidation.ts";
import * as destinations from "../lib/adsDestination.ts";
import * as googleIntent from "../lib/adsGooglePlanIntent.ts";
import * as preparedIntent from "../lib/adsPreparedPlanIntent.ts";
import * as metaIntent from "../lib/adsMetaPlanIntent.ts";
import * as openaiIntent from "../lib/adsOpenaiPlanIntent.ts";
import * as pinterestIntent from "../lib/adsPinterestPlanIntent.ts";
import * as googleLocations from "../lib/adsGoogleLocations.ts";
import * as quality from "../lib/adsPlanQuality.ts";
import { assertAiJsonMatchesSchema } from "../lib/aiJsonSchemaValidation.ts";

const brief = "Une image pour les visites du site en Hauts-de-France, pour les indépendants seuls et les entreprises de 2 à 10 salariés. Budget total 200 €. CTA En savoir plus.";
const profileLocations = ["Lille", "Arras", "Lens", "Béthune", "Douai", "Calais", "Saint-Omer"];
const context = { provider: "linkedin" as const, intent: brief, locations: profileLocations, city: "Harnes", country: "France", companyName: "iNrCy", destinationUrl: "https://inrcy.example/offre", services: ["Centralisation de la communication professionnelle"] };
const nativeDraft = {
  schemaVersion: 1, channel: "linkedin", name: "Votre communication professionnelle en Hauts-de-France",
  budget: { amount: 200, currency: "EUR", period: "daily", level: "campaign" },
  audience: { locationBriefs: profileLocations, audienceBrief: "Indépendants et dirigeants de petites entreprises en Hauts-de-France" },
  objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", locale: { country: "FR", language: "fr" },
  creative: { introText: "Retrouvez vos outils de communication dans un espace commun. Découvrez le fonctionnement d’iNrCy pour votre entreprise.", headline: "Retrouvez vos outils de communication", mediaBrief: "Une image claire du tableau de bord montrant les différents outils de communication, sans promesse chiffrée.", destinationUrl: context.destinationUrl, leadFormBrief: "" },
};
const raw = {
  brand: "iNrCy", name: nativeDraft.name, offer: context.services[0], objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "maximize_clicks", campaignType: "generic",
  primaryText: nativeDraft.creative.introText, headlines: [nativeDraft.creative.headline], descriptions: [nativeDraft.creative.introText], mediaBrief: nativeDraft.creative.mediaBrief,
  rationale: "Les indépendants et petites entreprises peuvent découvrir comment centraliser leur communication. Une image du tableau de bord invite à consulter le service dans la région demandée ; le suivi des inscriptions reste à vérifier.",
  channelDraft: nativeDraft,
};

test("the reported brief keeps its total envelope, region and requested professional facets even if AI fields are missing", () => {
  const plan = plans.normalizeAdsCampaignPlan(raw, context);
  assert.equal(plans.isReviewableAdsCampaignPlan(plan, "linkedin"), true);
  assert.deepEqual(plan.linkedinBudgetSuggestion, { type: "total", totalEuros: 200 });
  assert.equal(plan.channelDraft?.budget.period, "daily");
  assert.equal(plan.channelDraft?.budget.amount, 10, "the total must never leak into the legacy daily field");
  assert.deepEqual(plan.targetLocations, ["Hauts-de-France"]);
  assert.deepEqual(plan.channelDraft?.audience.locationBriefs, ["Hauts-de-France"]);
  assert.deepEqual(plan.linkedinTargetingSuggestions, [
    { facet: "seniorities", terms: ["Owner"] }, { facet: "companySizes", terms: ["Moi uniquement", "2-10"] },
  ]);
  assert.doesNotMatch(JSON.stringify(plan.linkedinTargetingSuggestions), /urn:/);
});

test("an explicit total wins over contradictory model budget and audience guesses", () => {
  const plan = plans.normalizeAdsCampaignPlan({ ...raw, linkedinBudgetSuggestion: { type: "daily", totalEuros: null }, linkedinTargetingSuggestions: [{ facet: "titles", terms: ["Marketing manager"] }, { facet: "companySizes", terms: ["10001+"] }] }, context);
  assert.deepEqual(plan.linkedinBudgetSuggestion, { type: "total", totalEuros: 200 });
  assert.deepEqual(plan.linkedinTargetingSuggestions, [{ facet: "seniorities", terms: ["Owner"] }, { facet: "companySizes", terms: ["Moi uniquement", "2-10"] }]);
});

test("large total envelopes remain valid without becoming daily budgets, while explicit daily amounts stay daily", () => {
  for (const total of [1000, 45_000]) {
    const plan = plans.normalizeAdsCampaignPlan({ ...raw, channelDraft: { ...nativeDraft, budget: { ...nativeDraft.budget, amount: total } } }, { ...context, intent: `Une campagne dans les Hauts-de-France. Budget total ${total} €.` });
    assert.deepEqual(plan.linkedinBudgetSuggestion, { type: "total", totalEuros: total });
    assert.equal(plan.channelDraft?.budget.amount, 10);
    assert.equal(plans.isReviewableAdsCampaignPlan(plan, "linkedin"), true);
  }
  const daily = plans.normalizeAdsCampaignPlan({ ...raw, linkedinBudgetSuggestion: { type: "total", totalEuros: 200 } }, { ...context, intent: "Une campagne en Hauts-de-France avec un budget de 20 € par jour." });
  assert.deepEqual(daily.linkedinBudgetSuggestion, { type: "daily", totalEuros: null });
  assert.equal(daily.channelDraft?.budget.amount, 20);
});

test("only budget amounts are extracted, decimal EUR is exact, and conflicting human amounts fail closed", () => {
  assert.deepEqual(intent.readLinkedInAdsPlanIntent("Budget total 200,50 euros pour une campagne ; essai de 21 jours.").budget, { type: "total", totalEuros: 200.5 });
  assert.equal(intent.readLinkedInAdsPlanIntent("Le service coûte 29 €/mois et l’essai dure 21 jours.").budget, null);
  assert.deepEqual(intent.readLinkedInAdsPlanIntent("Un abonnement de 29 €/mois avec budget total 200 €.").budget, { type: "total", totalEuros: 200 });
  assert.deepEqual(intent.readLinkedInAdsPlanIntent("Budget total 200 €. CPC manuel à 1,50 €.").budget, { type: "total", totalEuros: 200 });
  assert.deepEqual(intent.readLinkedInAdsPlanIntent("Budget total 200 € et coût cible moyen de 2 €.").budget, { type: "total", totalEuros: 200 });
  assert.deepEqual(intent.readLinkedInAdsPlanIntent("Pas de budget total de 500 euros ; budget total de 200 euros.").budget, { type: "total", totalEuros: 200 });
  assert.deepEqual(intent.readLinkedInAdsPlanIntent("Budget 200 € sur 10 jours.").budget, { type: "total", totalEuros: 200 });
  assert.equal(intent.readLinkedInAdsPlanIntent("Budget total 200 € puis une enveloppe totale de 300 €.").budgetIssue, "conflicting_budget");
  assert.equal(intent.readLinkedInAdsPlanIntent("Budget quotidien 20 € puis 30 € par jour.").budgetIssue, "conflicting_budget");
  assert.equal(intent.readLinkedInAdsPlanIntent("Budget total 45001 €.").budgetIssue, "invalid_budget");
  assert.throws(() => plans.normalizeAdsCampaignPlan(raw, { ...context, intent: "Budget total 200 € et total 300 €." }), /CONFLICTING_BUDGET/);
});

test("a combined total and daily limit is refused instead of silently dropping the daily cap", () => {
  const combined = "Budget total de 200 euros et plafond de 10 euros par jour.";
  assert.equal(intent.readLinkedInAdsPlanIntent(combined).budgetIssue, "combined_budget_unsupported");
  assert.equal(intent.readLinkedInAdsPlanIntent(combined).budget, null);
  assert.throws(() => plans.normalizeAdsCampaignPlan(raw, { ...context, intent: combined }), /COMBINED_BUDGET_UNSUPPORTED/);
});

test("explicit geography overrides profile cities while selected zones stay frozen and negated regions are not selected", () => {
  assert.deepEqual(intent.selectLinkedInAdsPlanLocations({ locations: ["Paris"], country: "France", intent: "Cibler les Hauts-de-France." }), ["Hauts-de-France"]);
  assert.deepEqual(intent.selectLinkedInAdsPlanLocations({ locations: ["Hauts-de-France", ...profileLocations], city: "Harnes", intent: "Campagne en Hauts-de-France." }), ["Hauts-de-France"]);
  assert.deepEqual(intent.selectLinkedInAdsPlanLocations({ locations: profileLocations, intent: "Campagne pour Lille et Arras." }), ["Lille", "Arras"]);
  assert.deepEqual(intent.selectLinkedInAdsPlanLocations({ locations: ["Paris"], intent: "Ne pas cibler les Hauts-de-France." }), ["Paris"]);
  assert.deepEqual(intent.selectLinkedInAdsPlanLocations({ locations: ["Hauts-de-France"], city: "Lille", locationsAreSelected: true }), ["Hauts-de-France"]);
  assert.deepEqual(plans.normalizeAdsCampaignPlan({ ...raw, targetLocations: ["France"] }, { ...context, locations: ["Hauts-de-France"], locationsAreSelected: true }).targetLocations, ["Hauts-de-France"]);
  assert.deepEqual(intent.selectLinkedInAdsPlanLocations({ locations: profileLocations, country: "France", intent: "Une campagne nationale dans toute la France." }), ["France"]);
});

test("the strict runtime schema requires both LinkedIn advice fields and rejects fabricated native IDs", () => {
  const schema = plans.linkedInAdsCampaignPlanResponseSchema();
  assert.equal(schema.strict, true);
  assert.ok((schema.schema.required as string[]).includes("linkedinBudgetSuggestion"));
  assert.ok((schema.schema.required as string[]).includes("linkedinTargetingSuggestions"));
  const completed = plans.normalizeAdsCampaignPlan(raw, context);
  assert.doesNotThrow(() => assertAiJsonMatchesSchema(completed, schema.schema));
  const withoutBudget = { ...completed };
  delete withoutBudget.linkedinBudgetSuggestion;
  assert.throws(() => assertAiJsonMatchesSchema(withoutBudget, schema.schema), /linkedinBudgetSuggestion/);
  const withoutTargeting = { ...completed };
  delete withoutTargeting.linkedinTargetingSuggestions;
  assert.throws(() => assertAiJsonMatchesSchema(withoutTargeting, schema.schema), /linkedinTargetingSuggestions/);
  assert.throws(() => assertAiJsonMatchesSchema({ ...completed, channelDraft: { ...completed.channelDraft, externalRefs: { adAccountUrn: "urn:li:sponsoredAccount:999" } } }, schema.schema), /externalRefs/);
  assert.doesNotThrow(() => assertAiJsonMatchesSchema(plans.normalizeLinkedInCampaignPlanResponse(withoutBudget, context), schema.schema));
});

function routeRuntime(fixedNow?: string) {
  let reservations = 0;
  const requests: Record<string, unknown>[] = [];
  const query = (table: string) => {
    const result = { data: table === "business_profiles" ? { company_legal_name: "iNrCy", country: "France", website: context.destinationUrl } : table === "profiles" ? { company_legal_name: "iNrCy" } : table === "business_ai_memories" ? { memory: {} } : [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
    chain.maybeSingle = async () => result;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result));
    return chain;
  };
  const fakeSupabase = { from: query };
  const emptyMemory = { referenceDocuments: [], specialties: [], targetAudiences: [], differentiators: [], customerNeeds: [], values: [], brandPersonality: [], commitments: [], preferredVocabulary: [], forbiddenVocabulary: [] };
  const modules = new Map<string, unknown>([
    ["node:crypto", { randomUUID: () => "request-test-123" }], ["next/server", { NextResponse: { json: (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), init) } }],
    ["@/lib/adsServer", { adsRequestOriginAllowed: () => true, isAdsChannelUserAllowed: async () => true, requirePremiumAdsUser: async () => ({ user: { authUserId: "auth-test", activeUserId: "owner-test", supabase: fakeSupabase } }) }],
    ["@/lib/adsCampaignPlan", plans], ["@/lib/adsChannelCapabilities", capabilities], ["@/lib/adsCampaignIntelligence", intelligence], ["@/lib/adsValidation", validation], ["@/lib/adsDestination", destinations], ["@/lib/adsPinterestPlanIntent", pinterestIntent], ["@/lib/adsGooglePlanIntent", googleIntent], ["@/lib/adsGoogleLocations", googleLocations], ["@/lib/adsPlanQuality", quality], ["@/lib/adsLinkedInPlanIntent", intent],
    ["@/lib/adsLinkedInPlanDelivery", delivery], ["@/lib/adsPreparedPlanIntent", preparedIntent], ["@/lib/adsMetaPlanIntent", metaIntent], ["@/lib/adsOpenaiPlanIntent", openaiIntent],
    ["@/lib/aiGatewayClient", { getAiGenerationAttemptTrace: () => null, aiGenerateJSON: async (options: Record<string, unknown>) => {
      requests.push(options);
      const completed = plans.normalizeAdsCampaignPlan(raw, { ...context, intent: "" });
      const missingAdvice = { ...completed };
      delete missingAdvice.linkedinBudgetSuggestion;
      delete missingAdvice.linkedinTargetingSuggestions;
      const normalize = options.normalizeResponseBeforeValidation as (value: unknown) => Record<string, unknown>;
      const normalized = normalize(missingAdvice);
      assertAiJsonMatchesSchema(normalized, (options.responseSchema as { schema: Record<string, unknown> }).schema);
      return normalized;
    } }],
    ["@/lib/aiGatewayPolicy", { createAiOperationBudget: () => ({}) }],
    ["@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => ({ business: { interventionZones: profileLocations, city: "Harnes", services: context.services, customerTypologies: ["Entreprises locales"], strengths: [] }, preferences: {} }) }],
    ["@/lib/aiMemory", { EMPTY_AI_MEMORY: emptyMemory, normalizeAiMemory: () => emptyMemory }],
    ["@/lib/aiUsageQuota", { reserveAiCredits: async () => { reservations++; return { reservation: {} }; }, commitAiCredits: async () => {}, rollbackAiCredits: async () => {} }],
    ["@/lib/professionalBusinessIdentity", { resolveProfessionalCompanyNameFromProfile: () => "iNrCy" }], ["@/lib/rateLimit", { enforceRateLimit: async () => null }],
    ["@/lib/observability/sentry", { captureApiException: () => {} }], ["@/lib/observability/request", { getRequestId: () => "request-test-123" }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: fakeSupabase }], ["@/lib/channelConnectionState", { getChannelConnectionStates: async () => null }],
  ]);
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  const compiled = ts.transpileModule(readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const clock = fixedNow ? new Proxy(Date, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [fixedNow], newTarget),
    get: (target, property, receiver) => property === "now" ? () => Date.parse(fixedNow) : Reflect.get(target, property, receiver),
  }) : Date;
  new Function("module", "exports", "require", "console", "Date", compiled)(loaded, loaded.exports, (specifier: string) => { assert.ok(modules.has(specifier), specifier); return modules.get(specifier); }, { info() {}, warn() {}, error() {} }, clock);
  return { post: loaded.exports.POST, requests, reservations: () => reservations };
}

test("the actual route supplies the strict schema and human constraints before transport validation without paid calls", async () => {
  const runtime = routeRuntime();
  const response = await runtime.post(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider: "linkedin", analysisMode: "goal", analysisObjective: brief }) }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(runtime.requests.length, 1);
  assert.equal((runtime.requests[0].responseSchema as { name: string }).name, "inrcy_linkedin_ads_campaign_plan");
  const sentContext = JSON.parse(String(runtime.requests[0].input).split("\n").slice(1).join("\n")) as Record<string, unknown>;
  assert.deepEqual(sentContext.zones, ["Hauts-de-France"]);
  assert.deepEqual((sentContext.linkedinHumanConstraints as { budget: unknown }).budget, { type: "total", totalEuros: 200 });
  const body = await response.json() as { plan: plans.AdsCampaignPlan };
  assert.deepEqual(body.plan.linkedinBudgetSuggestion, { type: "total", totalEuros: 200 });
  assert.deepEqual(body.plan.targetLocations, ["Hauts-de-France"]);
  assert.deepEqual(body.plan.channelDraft?.audience.locationBriefs, ["Hauts-de-France"]);
  assert.deepEqual(body.plan.linkedinTargetingSuggestions?.map((entry) => entry.facet), ["seniorities", "companySizes"]);
});

test("contradictory human budget is refused before reserving a credit or calling a model", async () => {
  for (const analysisObjective of ["Budget total 200 € puis enveloppe totale 300 €.", "Budget total de 200 euros et plafond de 10 euros par jour."]) {
    const runtime = routeRuntime();
    const response = await runtime.post(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider: "linkedin", analysisMode: "goal", analysisObjective }) }));
    assert.equal(response.status, 400);
    assert.equal(runtime.reservations(), 0);
    assert.equal(runtime.requests.length, 0);
  }
});

test("the route keeps requested Paris dates and permanent residence before AI schema validation", async () => {
  const runtime = routeRuntime("2026-10-08T10:00:00.000Z");
  const analysisObjective = `${brief} Résidence permanente. Du 9 octobre 2026 à 09:00 au 21 octobre 2026 à 23:59, heure de Paris.`;
  const response = await runtime.post(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider: "linkedin", analysisMode: "goal", analysisObjective, timezone: "America/New_York", now: "2090-01-01T00:00:00.000Z" }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as { plan: plans.AdsCampaignPlan };
  assert.deepEqual(body.plan.linkedinDeliverySuggestion?.budget, { startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" });
  assert.equal(body.plan.linkedinDeliverySuggestion?.locationType, "permanent");
  const sentContext = JSON.parse(String(runtime.requests[0].input).split("\n").slice(1).join("\n")) as Record<string, unknown>;
  assert.equal(sentContext.now, "2026-10-08T10:00:00.000Z", "a client timestamp cannot replace the route clock");
  assert.equal(sentContext.timezone, "America/New_York");
});

test("invalid or inverted explicit human dates fail before reserving credit or calling a model", async () => {
  for (const analysisObjective of ["Du 31 février 2027 à 09:00 au 10 mars 2027 à 23:59.", "Du 21 octobre 2026 à 09:00 au 9 octobre 2026 à 23:59.", "Du 9 octobre 2026 à 25:00 au 21 octobre 2026 à 23:59."]) {
    const runtime = routeRuntime("2026-10-08T10:00:00.000Z");
    const response = await runtime.post(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider: "linkedin", analysisMode: "goal", analysisObjective }) }));
    assert.equal(response.status, 400, analysisObjective);
    assert.equal(runtime.reservations(), 0);
    assert.equal(runtime.requests.length, 0);
  }
});

test("the route preserves a distinct manual bid without confusing it with the total budget", async () => {
  const runtime = routeRuntime("2026-10-08T10:00:00.000Z");
  const response = await runtime.post(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider: "linkedin", analysisMode: "goal", analysisObjective: `${brief} CPC manuel à 1,50 €.` }) }));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as { plan: plans.AdsCampaignPlan };
  assert.deepEqual(body.plan.linkedinBudgetSuggestion, { type: "total", totalEuros: 200 });
  assert.deepEqual(body.plan.linkedinDeliverySuggestion?.bidding, { strategy: "manual_cpc", amountEuros: 1.5 });
});
