import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as prepared from "../lib/adsPreparedPlanIntent.ts";
import { defaultPreparedDeliverySettings, plannedNativeCalendar } from "../lib/adsPreparedCampaignSettings.ts";
import { normalizeAdsCampaignPlan, isReviewableAdsCampaignPlan, adsCampaignPlanValidationIssueCodes } from "../lib/adsCampaignPlan.ts";
import { parseAdsCampaignInput, isAdsChannelId, isAdsDraftAccountChannel } from "../lib/adsValidation.ts";
import { assessAdsChannelDraft } from "../lib/adsChannelDrafts.ts";

const now = "2026-10-08T12:00:00.000Z";
const context = { now, timezone: "Europe/Paris", country: "France", locations: ["Lille", "Arras"], companyName: "Atelier Exemple", services: ["Accompagnement professionnel"], destinationUrl: "https://example.fr/offre" };
const base = { schemaVersion: 1, name: "Accompagnement local", budget: { amount: 200, currency: "EUR", period: "daily", level: "campaign" }, audience: { locationBriefs: ["Zone inventée"], audienceBrief: "Entreprises locales recherchant un accompagnement professionnel" } };
const native = {
  x: { ...base, channel: "x", objective: "website_traffic", format: "text", targetingMode: "broad", keywords: ["fake signal"], creative: { postText: "Découvrez un accompagnement local pour votre projet professionnel.", mediaBrief: "", destinationUrl: "https://model-invented.example/" } },
  tiktok: { ...base, channel: "tiktok", objectiveType: "TRAFFIC", format: "video", destinationKind: "website", placementIntent: "tiktok_only", optimizationIntent: "clicks", creative: { adText: "Découvrez notre accompagnement local", videoBrief: "Vidéo verticale à créer montrant une démonstration authentique du service.", destinationUrl: "https://model-invented.example/" } },
};
const raw = (provider: "x" | "tiktok") => ({ name: base.name, offer: context.services[0], objective: "website_traffic", campaignType: "generic", primaryText: "Découvrez notre accompagnement local pour votre projet.", rationale: "L’accompagnement répond à un besoin des entreprises locales. Une démonstration invite à consulter le service dans la région demandée ; les ressources et le suivi publicitaire restent à vérifier.", keywords: ["signal inventé"], negativeKeywords: ["gratuit"], channelDraft: native[provider] });
const endDate = new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10);
const saved = (provider: "x" | "tiktok") => ({ provider, accountCurrency: "EUR", adAccountId: "", name: base.name, creationMode: "inrcy", dailyBudgetEuros: 10, endDate, destinationUrl: context.destinationUrl, primaryText: "Découvrez notre accompagnement local.", headlines: ["Un accompagnement local"], descriptions: [], keywords: [], negativeKeywords: [], channelDraft: native[provider] });

test("human totals and daily amounts remain distinct, at the correct preparation budget level", () => {
  for (const provider of ["x", "tiktok"] as const) {
    for (const total of [200.5, 1000, 45_000]) {
      const plan = normalizeAdsCampaignPlan(raw(provider), { ...context, provider, intent: `Campagne en Hauts-de-France avec budget total ${total} € sur 10 jours.` });
      assert.equal(plan.preparedBudgetSuggestion?.type, "total"); assert.equal(plan.preparedBudgetSuggestion?.totalEuros, total); assert.equal(plan.preparedBudgetSuggestion?.dailyEuros, null);
      assert.deepEqual(plan.channelDraft?.budget, { amount: total, currency: "EUR", period: "lifetime", level: provider === "tiktok" ? "ad_group" : "campaign" });
      assert.equal(isReviewableAdsCampaignPlan(plan, provider), true);
      assert.deepEqual(adsCampaignPlanValidationIssueCodes(raw(provider), { ...context, provider, intent: `Budget total ${total} € sur 10 jours.` }), []);
      assert.equal(assessAdsChannelDraft(plan.channelDraft).publicationReady, false);
    }
    const daily = normalizeAdsCampaignPlan(raw(provider), { ...context, provider, intent: "Budget de 20,50 € par jour pour une campagne pendant 3 jours." });
    assert.equal(daily.preparedBudgetSuggestion?.dailyEuros, 20.5); assert.equal(daily.preparedBudgetSuggestion?.totalEuros, null); assert.equal(daily.channelDraft?.budget.period, "daily"); assert.equal(daily.channelDraft?.budget.amount, 20.5);
  }
});
test("explicit geography, trustworthy destination and absence of unsupported keywords survive model guesses", () => {
  for (const provider of ["x", "tiktok"] as const) {
    const plan = normalizeAdsCampaignPlan({ ...raw(provider), targetLocations: ["France"], preparedDeliverySuggestion: { pixelId: "invented" } }, { ...context, provider, intent: "Budget total 200 € pour une campagne en Hauts-de-France." });
    assert.deepEqual(plan.targetLocations, ["Hauts-de-France"]); assert.deepEqual(plan.channelDraft?.audience.locationBriefs, ["Hauts-de-France"]);
    assert.equal(plan.channelDraft?.creative.destinationUrl, context.destinationUrl); assert.deepEqual(plan.keywords, []); assert.deepEqual(plan.negativeKeywords, []);
    assert.equal("externalRefs" in (plan.channelDraft || {}), false); assert.equal("pixelId" in (plan.preparedDeliverySuggestion || {}), false);
  }
  const keywordPlan = normalizeAdsCampaignPlan({ ...raw("x"), channelDraft: { ...native.x, targetingMode: "keywords", keywords: ["accompagnement local"] } }, { ...context, provider: "x", intent: "Budget total 200 €." });
  assert.ok(keywordPlan.keywords.includes("accompagnement local")); assert.deepEqual(keywordPlan.negativeKeywords, []);
});
test("prepared human calendar retains Paris hours and duration, rejecting contradictions", () => {
  for (const provider of ["x", "tiktok"] as const) {
    const result = prepared.readPreparedAdsPlanIntent({ ...context, provider, intent: "Budget total 200 €. Du 9 octobre 2026 à 09:30 au 19 octobre 2026 à 17:45, heure de Paris." });
    assert.equal(result.error, null); assert.equal(result.budget?.startAt, "2026-10-09T07:30:00.000Z"); assert.equal(result.budget?.endAt, "2026-10-19T15:45:00.000Z");
    const duration = prepared.readPreparedAdsPlanIntent({ ...context, provider, intent: "Budget total 200 € pour une campagne pendant 2 semaines." });
    assert.equal(duration.budget?.endAt, "2026-10-22T12:15:00.000Z");
    for (const intent of ["Budget total 200 € et 20 € par jour.", "Budget total 200 € puis enveloppe totale 300 €.", "Budget total 45001 €.", "Budget quotidien 501 €.", "Budget total 200 € sur 91 jours.", "Début le 31 février 2027.", "Du 21 octobre 2026 au 9 octobre 2026.", "Du 9 octobre 2026 au 19 octobre 2026. Campagne pendant 3 jours."]) assert.ok(prepared.readPreparedAdsPlanIntent({ ...context, provider, intent }).error, `${provider}: ${intent}`);
  }
});
test("native prepared strategy names and exact amounts are preserved without confusing them with the budget", () => {
  const x = prepared.readPreparedAdsPlanIntent({ ...context, provider: "x", intent: "Budget total 200 €. Enchère maximale à 1,25 €." });
  assert.equal(x.error, null); assert.equal(x.budget?.totalEuros, 200); assert.deepEqual(x.deliverySettings?.bidding, { strategy: "max_bid", amountEuros: 1.25 });
  const tt = prepared.readPreparedAdsPlanIntent({ ...context, provider: "tiktok", intent: "Budget total 200 €. Cost cap de 2,50 €." });
  assert.equal(tt.error, null); assert.equal(tt.budget?.totalEuros, 200); assert.deepEqual(tt.deliverySettings?.bidding, { strategy: "cost_cap", amountEuros: 2.5 });
  for (const provider of ["x", "tiktok"] as const) {
    assert.deepEqual(prepared.readPreparedAdsPlanIntent({ ...context, provider, intent: "Budget quotidien 10 €. Enchères automatiques." }).deliverySettings?.bidding, { strategy: "automatic", amountEuros: null });
    assert.equal(prepared.readPreparedAdsPlanIntent({ ...context, provider, intent: "Pas de budget total 500 € ; budget total 200 €." }).budget?.totalEuros, 200);
    for (const intent of ["Budget total 200 €. Enchères automatiques et cost cap de 1 €.", "Budget total 200 €. CPA cible 10 €.", "Budget total 200 €. Budget quotidien flexible."]) assert.ok(prepared.readPreparedAdsPlanIntent({ ...context, provider, intent }).error);
  }
  assert.ok(prepared.readPreparedAdsPlanIntent({ ...context, provider: "tiktok", intent: "Budget total 200 €. CPC manuel à 1 €." }).error);
  assert.ok(prepared.readPreparedAdsPlanIntent({ ...context, provider: "x", intent: "Budget total 200 €. Cost cap de 1 €." }).error);
  for (const intent of ["Budget total 200 €. CPC à 1 €.", "Budget total 200 €. Enchère maximale.", "Budget total 200 €. Enchère maximale 1,234 €.", "Budget quotidien 10 €. Enchère maximale 11 €.", "Budget total 200 €. Enchère maximale 1 € puis enchère maximale 2 €."]) assert.ok(prepared.readPreparedAdsPlanIntent({ ...context, provider: "x", intent }).error, intent);
});
test("saving prepared settings synchronizes the channel budget without rewriting the legacy daily mirror", () => {
  for (const provider of ["x", "tiktok"] as const) {
    const settings = defaultPreparedDeliverySettings("total"); settings.budget.totalEuros = 1000;
    const input = saved(provider), original = JSON.stringify(input);
    const result = parseAdsCampaignInput({ ...input, preparedDeliverySettings: settings }, { purpose: "draft" });
    assert.equal(result.error, null); assert.equal(result.draft?.dailyBudgetEuros, 10); assert.deepEqual(result.draft?.preparedDeliverySettings, settings);
    assert.deepEqual(result.draft?.channelDraft?.budget, { amount: 1000, currency: "EUR", period: "lifetime", level: provider === "tiktok" ? "ad_group" : "campaign" });
    assert.equal(JSON.stringify(input), original);
    assert.equal(parseAdsCampaignInput({ ...input, preparedDeliverySettings: settings }, { purpose: "publish" }).draft, null);
    settings.budget.type = "daily"; settings.budget.totalEuros = null;
    const daily = parseAdsCampaignInput({ ...input, dailyBudgetEuros: 25, preparedDeliverySettings: settings }, { purpose: "draft" });
    assert.equal(daily.error, null); assert.equal(daily.draft?.channelDraft?.budget.amount, 25); assert.equal(daily.draft?.channelDraft?.budget.period, "daily");
  }
});
test("absence keeps historical drafts unchanged, without introducing prepared settings or new publication capability", () => {
  for (const provider of ["x", "tiktok"] as const) {
    const result = parseAdsCampaignInput(saved(provider), { purpose: "draft" });
    assert.equal(result.error, null); assert.equal(Object.hasOwn(result.draft!, "preparedDeliverySettings"), false); assert.deepEqual(result.draft?.channelDraft?.budget, base.budget);
    assert.equal(assessAdsChannelDraft(result.draft?.channelDraft).publicationReady, false);
  }
});
test("a selected TikTok advertiser stays draft data only and never unlocks publication", () => {
  const accountId = "1234567890123456789";
  const parsed = parseAdsCampaignInput({ ...saved("tiktok"), adAccountId: accountId }, { purpose: "draft" });
  assert.equal(parsed.error, null); assert.equal(parsed.draft?.adAccountId, accountId);
  assert.equal(isAdsDraftAccountChannel("tiktok"), false);
  assert.equal(parseAdsCampaignInput({ ...saved("tiktok"), adAccountId: accountId }, { purpose: "publish" }).draft, null);
  assert.ok(parseAdsCampaignInput({ ...saved("tiktok"), adAccountId: "invented-advertiser" }, { purpose: "draft" }).error);
});
test("prepared parser rejects external fields, other channels, invalid money/calendar and incompatible strategies", () => {
  const settings = defaultPreparedDeliverySettings("total"); settings.budget.totalEuros = 1000;
  for (const provider of ["meta", "google", "linkedin", "pinterest", "openai"]) assert.ok(parseAdsCampaignInput({ ...saved("x"), provider, preparedDeliverySettings: settings }, { purpose: "draft" }).error);
  for (const patch of [{ pixelId: "invented" }, { budget: { ...settings.budget, totalEuros: 45001 } }, { budget: { ...settings.budget, totalEuros: 1000.001 } }, { budget: { ...settings.budget, endAt: "2026-02-31T12:00:00Z" } }, { budget: { ...settings.budget, endAt: new Date(Date.now() - 86400000).toISOString() } }, { bidding: { strategy: "automatic", amountEuros: 1 } }]) assert.ok(parseAdsCampaignInput({ ...saved("x"), preparedDeliverySettings: { ...settings, ...patch } }, { purpose: "draft" }).error, JSON.stringify(patch));
  assert.ok(parseAdsCampaignInput({ ...saved("x"), preparedDeliverySettings: { ...settings, bidding: { strategy: "cost_cap", amountEuros: 1 } } }, { purpose: "draft" }).error);
  assert.ok(parseAdsCampaignInput({ ...saved("tiktok"), preparedDeliverySettings: { ...settings, bidding: { strategy: "max_bid", amountEuros: 1 } } }, { purpose: "draft" }).error);
  for (const channelDraft of [{ ...native.x, surprise: true }, { ...native.x, externalRefs: { adAccountId: "invented" } }, { ...native.x, budget: { ...base.budget, surprise: true } }]) assert.ok(parseAdsCampaignInput({ ...saved("x"), preparedDeliverySettings: settings, channelDraft }, { purpose: "draft" }).error);
});
test("ISO prepared times validate their own calendar instead of a different legacy end-date", () => {
  const settings = defaultPreparedDeliverySettings("total"); settings.budget.totalEuros = 200; settings.budget.endAt = new Date(Date.now() + 3600000).toISOString();
  const input = { ...saved("x"), endDate: new Date().toISOString().slice(0, 10), preparedDeliverySettings: settings };
  const parsed = parseAdsCampaignInput(input, { purpose: "draft" });
  assert.equal(parsed.error, null); assert.equal(plannedNativeCalendar(parsed.draft!).endAt, settings.budget.endAt);
  assert.ok(parseAdsCampaignInput({ ...input, preparedDeliverySettings: undefined }, { purpose: "draft" }).error);
});
test("only X/TikTok lifetime briefs gain the larger total range; daily and other channels stay bounded", () => {
  for (const provider of ["x", "tiktok"] as const) {
    assert.equal(assessAdsChannelDraft({ ...native[provider], budget: { ...base.budget, amount: 45_000, period: "lifetime" } }).briefComplete, true);
    for (const budget of [{ ...base.budget, amount: 501 }, { ...base.budget, amount: 45_001, period: "lifetime" }, { ...base.budget, amount: 1000.001, period: "lifetime" }]) assert.equal(assessAdsChannelDraft({ ...native[provider], budget }).briefComplete, false);
  }
});
test("invalid prepared human controls are rejected by the real route before database context, quota or model calls", async () => {
  let credits = 0, models = 0, databaseReads = 0;
  const exports = {} as { POST(request: Request): Promise<Response> };
  const modules: Record<string, unknown> = {
    "node:crypto": { randomUUID: () => "test-request" },
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), init) } },
    "@/lib/adsValidation": { isAdsChannelId }, "@/lib/adsPreparedPlanIntent": prepared,
    "@/lib/adsServer": { adsRequestOriginAllowed: () => true, requirePremiumAdsUser: async () => ({ user: { authUserId: "auth", activeUserId: "owner", supabase: { from: () => { databaseReads++; throw new Error("Unexpected database context read"); } } } }), isAdsChannelUserAllowed: async () => true },
    "@/lib/observability/request": { getRequestId: () => "test-request" },
    "@/lib/aiUsageQuota": { reserveAiCredits: async () => { credits++; return {}; } },
    "@/lib/aiGatewayClient": { aiGenerateJSON: async () => { models++; return {}; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "require", code)(exports, (name: string) => modules[name] || {});
  for (const provider of ["x", "tiktok"] as const) {
    for (const analysisObjective of ["Budget total 200 € et 10 € par jour.", "Budget total 45001 €.", "Début le 31 février 2027.", "Campagne avec budget total 200 € sur 91 jours.", provider === "x" ? "Budget total 200 €. Cost cap de 1 €." : "Budget total 200 €. CPC manuel à 1 €."]) {
      const response = await exports.POST(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider, analysisMode: "goal", analysisObjective }) }));
      assert.equal(response.status, 400, analysisObjective); assert.equal((await response.json()).code, "ADS_PREPARED_PLAN_DELIVERY_INVALID");
    }
  }
  assert.equal(credits, 0); assert.equal(models, 0); assert.equal(databaseReads, 0);
});

test("successful real plan route preserves prepared totals, dates, geography and bids from the human brief", async () => {
  const modules = await Promise.all([
    import("../lib/adsCampaignPlan.ts"), import("../lib/adsCampaignIntelligence.ts"), import("../lib/adsChannelCapabilities.ts"), import("../lib/adsDestination.ts"), import("../lib/adsPlanQuality.ts"), import("../lib/adsLinkedInPlanIntent.ts"), import("../lib/adsLinkedInPlanDelivery.ts"), import("../lib/adsGooglePlanIntent.ts"), import("../lib/adsGoogleLocations.ts"), import("../lib/adsPinterestPlanIntent.ts"), import("../lib/adsMetaPlanIntent.ts"), import("../lib/adsOpenaiPlanIntent.ts"),
  ]);
  for (const provider of ["x", "tiktok"] as const) {
    let credits = 0, committed = 0, models = 0;
    const modelContexts: Record<string, unknown>[] = [];
    const query = (table: string) => {
      const result = { data: table === "business_profiles" ? { company_legal_name: context.companyName, hq_country: "France", website: context.destinationUrl } : table === "profiles" ? { company_legal_name: context.companyName, hq_country: "France" } : table === "business_ai_memories" ? { memory: {} } : [], error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
      chain.maybeSingle = async () => result; chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)); return chain;
    };
    const database = { from: query };
    const memory = { referenceDocuments: [], specialties: [], targetAudiences: [], differentiators: [], customerNeeds: [], values: [], brandPersonality: [], commitments: [], preferredVocabulary: [], forbiddenVocabulary: [] };
    const names = ["adsCampaignPlan", "adsCampaignIntelligence", "adsChannelCapabilities", "adsDestination", "adsPlanQuality", "adsLinkedInPlanIntent", "adsLinkedInPlanDelivery", "adsGooglePlanIntent", "adsGoogleLocations", "adsPinterestPlanIntent", "adsMetaPlanIntent", "adsOpenaiPlanIntent"];
    const imports: Record<string, unknown> = Object.fromEntries(names.map((name, index) => [`@/lib/${name}`, modules[index]]));
    Object.assign(imports, {
      "node:crypto": { randomUUID: () => "prepared-test-request" }, "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
      "@/lib/adsValidation": { isAdsChannelId }, "@/lib/adsPreparedPlanIntent": prepared,
      "@/lib/adsServer": { adsRequestOriginAllowed: () => true, requirePremiumAdsUser: async () => ({ user: { authUserId: "auth", activeUserId: "owner", supabase: database } }), isAdsChannelUserAllowed: async () => true },
      "@/lib/observability/request": { getRequestId: () => "prepared-test-request" }, "@/lib/observability/sentry": { captureApiException() {} }, "@/lib/rateLimit": { enforceRateLimit: async () => null },
      "@/lib/aiUsageQuota": { reserveAiCredits: async () => { credits++; return { reservation: {} }; }, commitAiCredits: async () => { committed++; }, rollbackAiCredits: async () => {} },
      "@/lib/aiGatewayClient": { getAiGenerationAttemptTrace: () => null, aiGenerateJSON: async (options: Record<string, unknown>) => { models++; modelContexts.push(JSON.parse(String(options.input).split("\n").slice(1).join("\n"))); return raw(provider); } },
      "@/lib/aiGatewayPolicy": { createAiOperationBudget: () => ({}) },
      "@/lib/aiGenerationProfile": { buildNormalizedAiGenerationProfile: () => ({ business: { interventionZones: context.locations, city: "Lille", services: context.services, customerTypologies: ["Entreprises locales"], strengths: [] }, preferences: {} }) },
      "@/lib/aiMemory": { EMPTY_AI_MEMORY: memory, normalizeAiMemory: () => memory }, "@/lib/professionalBusinessIdentity": { resolveProfessionalCompanyNameFromProfile: () => context.companyName },
      "@/lib/supabaseAdmin": { supabaseAdmin: database }, "@/lib/channelConnectionState": { getChannelConnectionStates: async () => null },
    });
    const exports = {} as { POST(request: Request): Promise<Response> };
    const source = readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const clock = new Proxy(Date, { construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now], newTarget), get: (target, property, receiver) => property === "now" ? () => Date.parse(now) : Reflect.get(target, property, receiver) });
    new Function("exports", "require", "console", "Date", code)(exports, (name: string) => { assert.ok(name in imports, name); return imports[name]; }, { info() {}, warn() {}, error() {} }, clock);
    const bid = provider === "tiktok" ? "Cost cap de 2,50 €." : "Enchère maximale à 1,25 €.";
    const response = await exports.POST(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider, analysisMode: "goal", analysisObjective: `Campagne en Hauts-de-France, budget total 1000 €. Du 9 octobre 2026 à 09:30 au 19 octobre 2026 à 17:45, heure de Paris. ${bid}` }) }));
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json(); const plan = body.plan;
    assert.equal(body.draftOnly, true); assert.equal(body.publicationReady, false); assert.equal(credits, 1); assert.equal(committed, 1); assert.equal(models, 1);
    assert.deepEqual(modelContexts[0].zones, ["Hauts-de-France"]); assert.deepEqual(plan.targetLocations, ["Hauts-de-France"]);
    assert.deepEqual(plan.preparedBudgetSuggestion, { type: "total", dailyEuros: null, totalEuros: 1000, startAt: "2026-10-09T07:30:00.000Z", endAt: "2026-10-19T15:45:00.000Z" });
    assert.deepEqual(plan.channelDraft.budget, { amount: 1000, currency: "EUR", period: "lifetime", level: provider === "tiktok" ? "ad_group" : "campaign" });
    assert.deepEqual(plan.preparedDeliverySuggestion.bidding, provider === "tiktok" ? { strategy: "cost_cap", amountEuros: 2.5 } : { strategy: "max_bid", amountEuros: 1.25 });
    assert.deepEqual(plan.keywords, []); assert.deepEqual(plan.negativeKeywords, []); assert.equal("externalRefs" in plan.channelDraft, false);
  }
});
