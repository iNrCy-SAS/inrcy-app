import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as promptBudget from "../lib/adsPlanPromptBudget.ts";
import { AI_FEATURE_POLICIES, getAiFeaturePolicy } from "../lib/aiGatewayPolicy.ts";

const { buildAdsPlanBudgetedPrompt, adsPlanEffectiveSystemPrompt, AdsPlanPromptBudgetError } = promptBudget;
const limit = AI_FEATURE_POLICIES["ads.generate"].maxInputChars;
const prefix = "DONNÉES FIABLES DE L’ENTREPRISE :\n";
const protectedContext = {
  companyName: "Agence Exemple", sector: "Immobilier", profession: "Agent immobilier",
  description: "Accompagnement des propriétaires dans leur projet immobilier.",
  services: ["Estimation immobilière", "Accompagnement de la vente"],
  zones: ["Arras", "Lens"], restrictions: ["Ne promettre aucun délai de vente"],
  localContext: { city: "Arras", website: "https://example.test/offre" },
  preferredDestinationUrl: "https://example.test/offre",
  professionalIntent: "Budget total 200 €. Du 1er au 15 décembre, uniquement Arras et Lens.",
  analysisDirection: { mode: "objectif précis", objective: "Trouver des propriétaires vendeurs" },
  communicationPreferences: { language: "fr", customInstructions: "Conserver le vouvoiement.", forbiddenInstructions: "Ne jamais garantir un résultat." },
  linkedinHumanConstraints: { budget: { type: "total", totalEuros: 200 } },
  linkedinHumanDelivery: { budget: { startAt: "2026-12-01T09:00:00+01:00", endAt: "2026-12-15T19:00:00+01:00" } },
};

function payload(input: string) {
  return JSON.parse(input.slice(prefix.length).split("\nCONTRÔLE QUALITÉ :")[0]);
}

// Execute the actual local Gateway guard without loading its transports.
const gatewaySource = readFileSync(new URL("../lib/aiGatewayClient.ts", import.meta.url), "utf8");
const gatewayAst = ts.createSourceFile("gateway.ts", gatewaySource, ts.ScriptTarget.Latest, true);
const guardNode = gatewayAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "validatePayloadAgainstPolicy");
assert.ok(guardNode);
const guardCode = ts.transpileModule(guardNode.getText(gatewayAst), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const validateGateway = new Function("getAiFeaturePolicy", "console", `${guardCode}; return validatePayloadAgainstPolicy;`)(getAiFeaturePolicy, { error() {} }) as (options: Record<string, unknown>, tokens: number, system: string) => void;

test("recorded 13,896 + 19,623 request reproduces the guard failure and fits after optional context removal", () => {
  assert.equal(limit, 28_000, "the global Ads guard must remain unchanged");
  const context = { ...protectedContext, history: [{ name: "" }] };
  context.history[0].name = "x".repeat(19_623 - prefix.length - JSON.stringify(context).length);
  const originalInput = prefix + JSON.stringify(context);
  const system = "s".repeat(13_896);
  assert.equal(originalInput.length, 19_623);
  assert.throws(() => validateGateway({ feature: "ads.generate", input: originalInput }, 8_000, system), /33519\/28000/);
  const result = buildAdsPlanBudgetedPrompt({ system, context, maxInputChars: limit });
  assert.equal(result.originalInputChars, 19_623);
  assert.ok(result.compacted);
  assert.ok(result.totalChars <= limit);
  assert.deepEqual(payload(result.input), protectedContext);
  assert.doesNotThrow(() => validateGateway({ feature: "ads.generate", input: result.input }, 8_000, result.system));
  assert.equal(context.history[0].name.length, 19_623 - prefix.length - JSON.stringify({ ...protectedContext, history: [{ name: "" }] }).length, "source context is not mutated");
});

test("a request already within budget retains every optional field and byte of serialized context", () => {
  const context = { ...protectedContext, history: [], recentPublications: [{ content: "Phrase intacte.\n\nDeuxième paragraphe, avec des guillemets : \"exemple\" et un emoji 🏡." }] };
  const result = buildAdsPlanBudgetedPrompt({ system: "Consignes inchangées.", context, maxInputChars: limit });
  assert.equal(result.input, prefix + JSON.stringify(context));
  assert.equal(result.compacted, false);
  assert.deepEqual(result.removedSections, []);
});

test("serialized escapes and full repair feedback are measured, while human constraints remain intact", () => {
  const facts = {
    ...protectedContext,
    referenceDocuments: [{ excerpt: 'Bien immobilier : \"honoraires à la charge du vendeur\".\nPas de division du terrain.\\ Document original.' }],
    offers: "Estimation offerte uniquement après étude du dossier, sans engagement.",
    proofPointsAndObjections: "La qualification est attestée dans le document joint.",
    objectionResponses: "Ne pas confondre estimation et garantie de prix de vente.",
    campaignCalendar: "Offre valable du 1er au 15 décembre uniquement.",
  };
  const context = { ...facts, recentPublications: [{ content: '\"\n\\'.repeat(3_000) }] };
  const repair = { issueCodes: ["primary_text_too_long"], instructions: "Réécris sans couper le texte ni inventer de fait.", details: "Retour qualité complet : " + "d".repeat(4_900) };
  const result = buildAdsPlanBudgetedPrompt({ system: "s".repeat(13_896), context, maxInputChars: limit, repair });
  assert.deepEqual(payload(result.input), facts);
  assert.ok(result.input.endsWith(repair.details));
  assert.ok(result.input.includes(repair.instructions));
  assert.equal(result.totalChars, 13_896 + result.input.length);
  assert.doesNotThrow(() => validateGateway({ feature: "ads.generate", input: result.input }, 4_000, result.system));
});

test("strict transport and prompt-only schema overhead follow the Gateway's actual counting", () => {
  const responseSchema = { schema: { type: "object", properties: { message: { type: "string", description: "d".repeat(6_000) } } } };
  for (const jsonMode of ["strict", "prompt-only"] as const) {
    const args = { system: "s".repeat(13_896), jsonMode, responseSchema };
    const context = { ...protectedContext, history: [{ name: "ancien".repeat(2_000) }] };
    const result = buildAdsPlanBudgetedPrompt({ ...args, context, maxInputChars: limit });
    const effectiveSystem = adsPlanEffectiveSystemPrompt(args);
    assert.equal(result.systemChars, effectiveSystem.length);
    assert.ok(result.totalChars <= limit);
    assert.doesNotThrow(() => validateGateway({ feature: "ads.generate", input: result.input }, 8_000, effectiveSystem));
    if (jsonMode === "strict") assert.equal(result.systemChars, args.system.length);
    else assert.ok(result.systemChars > args.system.length + JSON.stringify(responseSchema.schema).length);
  }
});

test("an oversized indispensable core fails explicitly without cutting or dropping human instructions", () => {
  const context = { ...protectedContext, professionalIntent: "Instruction importante. ".repeat(2_000), history: [{ name: "optional" }] };
  assert.throws(() => buildAdsPlanBudgetedPrompt({ system: "règles qualité", context, maxInputChars: limit }), AdsPlanPromptBudgetError);
  assert.equal(context.history.length, 1);
  assert.equal(context.professionalIntent, "Instruction importante. ".repeat(2_000));
});

const actualModules = new Map<string, unknown>();
for (const name of ["adsMetaPlanIntent", "adsBudgetRecommendation", "adsOpenaiPlanIntent", "adsCampaignPlan", "adsChannelCapabilities", "adsCampaignIntelligence", "adsValidation", "adsDestination", "adsPreparedPlanIntent", "adsPinterestPlanIntent", "adsGooglePlanIntent", "adsGoogleLocations", "adsLinkedInPlanIntent", "adsLinkedInPlanDelivery", "adsPlanQuality", "aiContentLocation", "aiGatewayPolicy", "adsPlanPromptBudget"]) {
  actualModules.set(`@/lib/${name}`, await import(`../lib/${name}.ts`));
}

test("actual system prompts retain each channel's complete native rules without contradictory instructions from the other channel", () => {
  const source = readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "planSystemPrompt");
  assert.ok(node);
  const code = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const quality = actualModules.get("@/lib/adsPlanQuality") as typeof import("../lib/adsPlanQuality.ts");
  const capabilities = actualModules.get("@/lib/adsChannelCapabilities") as typeof import("../lib/adsChannelCapabilities.ts");
  const plans = actualModules.get("@/lib/adsCampaignPlan") as typeof import("../lib/adsCampaignPlan.ts");
  const build = new Function("isPlannedAdsChannel", "plannedAdsChannelPlanPrompt", "ADS_PLAN_EDITORIAL_INSTRUCTIONS", "ADS_PLAN_STRATEGY_INSTRUCTIONS", `${code}; return planSystemPrompt;`)(capabilities.isPlannedAdsChannel, plans.plannedAdsChannelPlanPrompt, quality.ADS_PLAN_EDITORIAL_INSTRUCTIONS, quality.ADS_PLAN_STRATEGY_INSTRUCTIONS) as (provider: string) => string;
  const meta = build("meta");
  const google = build("google");
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  // Fingerprints cover the complete pre-fix native paragraphs, including copy,
  // formats, destinations, bids, budget, conversions and sensitive attributes.
  assert.equal(digest(meta.split("\n").filter((line) => line.startsWith("Pour Meta")).join("\n")), "be652ca8203e9529d7e2e8ddca978089ca3d3c76ff0a59fa63dea4b909df4109");
  assert.equal(digest(google.split("\n").filter((line) => line.startsWith("Pour Google")).join("\n")), "cd10b04b2f46ca01cbaf77922f7a417da3386cde855dc2619c3f06734216e202");
  assert.doesNotMatch(meta, /Pour Google Search[:,]|Pour Google :|Pour Performance Max|propose 8 à 12 requêtes|Donne 8 à 12 titres/);
  assert.doesNotMatch(google, /Pour Meta|Fournis exactement un titre et au maximum une description/);
  assert.match(google, /Pour Google Search, c'est la synthèse rédigée de l'offre ; elle ne remplace ni les titres ni les descriptions\./);
  for (const system of [meta, google]) {
    assert.ok(system.includes(quality.ADS_PLAN_EDITORIAL_INSTRUCTIONS));
    assert.ok(system.includes(quality.ADS_PLAN_STRATEGY_INSTRUCTIONS));
    assert.match(system, /destinationUrl doit reprendre l’URL fiable fournie/);
    assert.match(system, /primaryText contient au plus 500 caractères/);
  }
});

async function routeRuntime(options: { impossibleCore?: boolean; repair?: boolean; repairImpossible?: boolean } = {}) {
  const requests: Record<string, unknown>[] = [];
  let reservations = 0;
  const logs: { label: string; detail: Record<string, unknown> }[] = [];
  const repeatList = (count: number, size: number) => Array.from({ length: count }, (_, i) => `${i}:` + "x".repeat(size - 2));
  const memory = {
    referenceDocuments: Array.from({ length: 3 }, () => ({ status: "analysed", name: "Document", note: "n".repeat(280), extractedText: "d".repeat(900) })),
    specialties: [], targetAudiences: [], differentiators: repeatList(12, 80), customerNeeds: repeatList(12, 80), values: repeatList(10, 120), brandPersonality: repeatList(10, 120), commitments: repeatList(10, 80), preferredVocabulary: repeatList(16, 100), forbiddenVocabulary: ["Interdiction intacte"],
    offersAndArguments: "o".repeat(600), proofsAndObjections: "p".repeat(800), objectionResponses: "r".repeat(600), editorialStrategy: "e".repeat(500), campaignCalendar: "c".repeat(400),
  };
  if (options.repairImpossible) {
    for (const [key, value] of Object.entries(memory)) {
      (memory as Record<string, unknown>)[key] = Array.isArray(value) ? [] : "";
    }
  }
  const query = (table: string) => {
    const result = { data: table === "business_profiles" ? { company_name: "Agence Exemple", country: "France", website: "https://example.test/offre" } : table === "profiles" ? { company_legal_name: "Agence Exemple", hq_country: "France" } : table === "business_ai_memories" ? { memory } : table === "ads_campaigns" ? repeatList(8, 100).map((name) => ({ name, provider: "meta" })) : repeatList(6, 360).map((content) => ({ content, title: "Ancien titre", cta: "Ancien appel", idea: "Ancienne idée" })), error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
    chain.maybeSingle = async () => result;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result));
    return chain;
  };
  const supabase = { from: query };
  const modules = new Map(actualModules);
  const rawPlan = {
    name: "Accompagnement immobilier local", offer: "Accompagnement de la vente immobilière", primaryText: "Préparez votre projet immobilier à Arras avec notre agence. Découvrez notre accompagnement.",
    headlines: ["Votre projet immobilier"], descriptions: ["Découvrez notre accompagnement immobilier à Arras."], mediaBrief: "Montrer un échange professionnel dans une agence immobilière.",
    rationale: "Les propriétaires d’Arras peuvent découvrir les services de l’agence pour leur projet de vente. Le format image met en valeur cet accompagnement et invite à consulter le site ; le suivi des contacts reste à vérifier.",
    budgetRecommendation: { dailyEuros: 25, durationDays: 14, rationale: "Une première période de test permet d’observer les visites sur le site, puis d’ajuster le budget selon les résultats réellement mesurés." },
  };
  modules.set("node:crypto", { randomUUID: () => "89d6567e-5bd9-4969-88ed-63015e95c5ef" });
  modules.set("next/server", { NextResponse: { json: (value: unknown, init?: ResponseInit) => new Response(JSON.stringify(value), init) } });
  modules.set("@/lib/adsServer", { adsRequestOriginAllowed: () => true, isAdsChannelUserAllowed: async () => true, requirePremiumAdsUser: async () => ({ user: { authUserId: "auth-test", activeUserId: "owner-test", supabase } }) });
  modules.set("@/lib/aiGatewayClient", { getAiGenerationAttemptTrace: () => null, aiGenerateJSON: async (request: Record<string, unknown>) => {
    requests.push(request);
    validateGateway(request, Number(request.maxOutputTokens), String(request.system));
    return structuredClone((options.repair || options.repairImpossible) && requests.length === 1 ? { ...rawPlan, primaryText: "Texte trop long. ".repeat(60) } : rawPlan);
  } });
  modules.set("@/lib/aiGenerationProfile", { buildNormalizedAiGenerationProfile: () => ({ business: { interventionZones: ["Arras", "Lens"], city: "Arras", services: protectedContext.services, customerTypologies: ["Propriétaires vendeurs"], strengths: [] }, preferences: { language: "fr", customInstructions: "Conserver le vouvoiement.", forbiddenInstructions: "Ne jamais garantir un résultat.", likedExample: "x".repeat(800), likedExample2: "y".repeat(800) } }) });
  modules.set("@/lib/aiMemory", { EMPTY_AI_MEMORY: memory, normalizeAiMemory: () => memory });
  modules.set("@/lib/aiUsageQuota", { reserveAiCredits: async () => { reservations++; return { reservation: {} }; }, commitAiCredits: async () => {}, rollbackAiCredits: async () => {} });
  modules.set("@/lib/professionalBusinessIdentity", { resolveProfessionalCompanyNameFromProfile: () => options.impossibleCore ? "c".repeat(30_000) : options.repairImpossible ? "c".repeat(15_300) : "Agence Exemple" });
  modules.set("@/lib/rateLimit", { enforceRateLimit: async () => null });
  modules.set("@/lib/observability/sentry", { captureApiException: () => {} });
  modules.set("@/lib/observability/request", { getRequestId: () => null });
  modules.set("@/lib/supabaseAdmin", { supabaseAdmin: supabase });
  modules.set("@/lib/channelConnectionState", { getChannelConnectionStates: async () => null });
  const loaded = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  const source = readFileSync(new URL("../app/api/ads/plan/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const log = (label: string, detail: Record<string, unknown>) => logs.push({ label, detail });
  new Function("module", "exports", "require", "console", compiled)(loaded, loaded.exports, (specifier: string) => { assert.ok(modules.has(specifier), specifier); return modules.get(specifier); }, { info: log, warn: log, error: log });
  const post = () => loaded.exports.POST(new Request("https://inrcy.example/api/ads/plan", { method: "POST", body: JSON.stringify({ provider: "meta", analysisMode: "goal", analysisObjective: protectedContext.professionalIntent, destinationUrl: protectedContext.preferredDestinationUrl }) }));
  return { post, requests, logs, reservations: () => reservations };
}

test("the actual Meta route compacts rich ADN before transport, preserving destination, zones and human constraints", async () => {
  const runtime = await routeRuntime();
  const response = await runtime.post();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(runtime.requests.length, 1);
  assert.equal(runtime.reservations(), 1);
  const sent = payload(String(runtime.requests[0].input));
  assert.deepEqual(sent.zones, ["Arras", "Lens"]);
  assert.equal(sent.professionalIntent, protectedContext.professionalIntent);
  assert.equal(sent.preferredDestinationUrl, protectedContext.preferredDestinationUrl);
  assert.equal(sent.communicationPreferences.language, "fr");
  assert.equal(sent.communicationPreferences.customInstructions, "Conserver le vouvoiement.");
  assert.equal(sent.communicationPreferences.forbiddenInstructions, "Ne jamais garantir un résultat.");
  assert.deepEqual(sent.restrictions, ["Interdiction intacte"]);
  assert.equal(sent.referenceDocuments.length, 3);
  assert.equal(sent.referenceDocuments[0].excerpt, "d".repeat(900));
  assert.equal(sent.offers, "o".repeat(600));
  assert.equal(sent.proofPointsAndObjections, "p".repeat(800));
  assert.equal(sent.objectionResponses, "r".repeat(600));
  assert.equal(sent.campaignCalendar, "c".repeat(400));
  assert.ok(runtime.logs.some((entry) => entry.label === "[ads.plan] optional input compacted"));
});

test("the actual route remeasures quality repair without changing the four-call ceiling or losing feedback", async () => {
  const runtime = await routeRuntime({ repair: true });
  const response = await runtime.post();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(runtime.requests.length, 2);
  assert.ok(String(runtime.requests[1].input).includes("CONTRÔLE QUALITÉ"));
  assert.ok(String(runtime.requests[1].input).includes("primary_text_too_long"));
  for (const request of runtime.requests) {
    assert.ok(String(request.system).length + String(request.input).length <= limit);
    assert.equal(request.allowProviderFallback, false);
    assert.deepEqual(payload(String(request.input)).zones, ["Arras", "Lens"]);
  }
});

test("the actual route refuses an indispensable core once with actionable 422 before credit or model", async () => {
  const runtime = await routeRuntime({ impossibleCore: true });
  const response = await runtime.post();
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.code, "ADS_PLAN_CONTEXT_TOO_LARGE");
  assert.equal(body.error, promptBudget.ADS_PLAN_CONTEXT_TOO_LARGE_MESSAGE);
  assert.equal(body.requestId, "89d6567e-5bd9-4969-88ed-63015e95c5ef");
  assert.equal(runtime.requests.length, 0);
  assert.equal(runtime.reservations(), 0);
});

test("an indispensable repair that cannot fit stops after the first local model stub instead of trying other suppliers", async () => {
  const runtime = await routeRuntime({ repairImpossible: true });
  const response = await runtime.post();
  assert.equal(response.status, 422, await response.clone().text());
  assert.equal((await response.json()).code, "ADS_PLAN_CONTEXT_TOO_LARGE");
  assert.equal(runtime.requests.length, 1);
  assert.equal(runtime.reservations(), 1);
  assert.ok(String(runtime.requests[0].system).length + String(runtime.requests[0].input).length <= limit);
});
