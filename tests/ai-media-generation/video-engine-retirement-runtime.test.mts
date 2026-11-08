import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type * as Contracts from "../../lib/aiMediaGenerationContracts.ts";
import type * as Catalog from "../../lib/aiMediaModelCatalog.ts";

// The same file tests a reviewed draft without touching the Desktop checkout,
// and tests the real repo directly after integration.
const candidateRoot = fileURLToPath(new URL("../../", import.meta.url));
const repo = fs.existsSync(path.join(candidateRoot, "package.json")) ? candidateRoot : process.cwd();
const ts = createRequire(path.join(repo, "package.json"))("typescript") as typeof import("typescript");
type Row = Record<string, unknown>;
function runtime(stubs: Row = {}, exposeParser = false) {
  const cache = new Map<string, { exports: unknown }>();
  function load<T>(name: string): T {
    const absolute = path.isAbsolute(name) ? name : path.resolve(repo, name);
    const previous = cache.get(absolute); if (previous) return previous.exports as T;
    const relative = path.relative(repo, absolute), draft = path.join(candidateRoot, relative);
    const source = fs.readFileSync(fs.existsSync(draft) ? draft : absolute, "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const record: { exports: unknown } = { exports: {} }; cache.set(absolute, record);
    const require = createRequire(path.join(repo, "package.json"));
    new Function("module", "exports", "require", compiled + (exposeParser && relative.replaceAll("\\", "/") === "lib/inrAssistantMediaTools.ts" ? "\nexports.__parseInput = parseInput;" : ""))(record, record.exports, (id: string) => {
      if (Object.hasOwn(stubs, id)) return stubs[id];
      if (id === "server-only") return {};
      if (id.startsWith("@/")) return load(`${id.slice(2)}${id.endsWith(".ts") ? "" : ".ts"}`);
      if (id.startsWith(".")) return load(path.resolve(path.dirname(absolute), `${id}${id.endsWith(".ts") ? "" : ".ts"}`));
      return require(id);
    });
    return record.exports as T;
  }
  return load;
}
const nativeFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { throw new Error("Offline speed tests must not access the network"); }; });
test.after(() => { globalThis.fetch = nativeFetch; });

const retiredEngines = [
  { engine: "wan3", modelId: "alibaba/wan-v3.0-video", resolution: "1080p", reason: /Wan 3\.0.*autre moteur/ },
  { engine: "minimax-h3", modelId: "minimax/minimax-h3", resolution: "768p", reason: /MiniMax H3.*autre moteur/ },
] as const;

test("Wan3 and MiniMax H3 are retired globally while historical metadata and HeyGen policy stay readable", () => {
  const catalog = runtime()<typeof Catalog>("lib/aiMediaModelCatalog.ts");
  for (const { engine, modelId, resolution, reason } of retiredEngines) {
    assert.equal(catalog.isAiMediaVideoEngineAvailable(engine), false);
    assert.equal(catalog.getAiMediaVideoModel(engine).modelId, modelId);
    assert.ok(catalog.getAiMediaVideoModel(engine).resolutions.includes(resolution));
    assert.equal(catalog.getAiMediaVideoEngineRetirementIssue(engine)?.code, "AI_MEDIA_VIDEO_ENGINE_RETIRED");
    assert.match(catalog.getAiMediaVideoEngineRetirementIssue(engine)!.message, reason);
    assert.deepEqual(catalog.restoreAiMediaVideoPreference(engine, resolution), { videoEngine: "omni", videoResolution: "720p" });
  }
  assert.equal(catalog.isAiMediaVideoEngineAvailable("heygen"), false);
  assert.equal(catalog.getAiMediaVideoEngineRetirementIssue("heygen"), null, "do not widen the existing HeyGen policy");
  const activeEngines = ["omni", "veo", "veo-lite", "wan-flash", "wan27", "grok-lite", "grok"];
  assert.deepEqual(catalog.AI_MEDIA_AVAILABLE_VIDEO_MODELS.map(model => model.id), activeEngines);
  for (const engine of activeEngines) {
    assert.equal(catalog.getAiMediaVideoEngineRetirementIssue(engine), null);
    assert.equal(catalog.isAiMediaVideoEngineAvailable(engine), true);
  }
});

test("all client choices and recommendation contexts exclude retired generation engines", () => {
  const load = runtime();
  const catalog = load<typeof Catalog>("lib/aiMediaModelCatalog.ts");
  const options = load<typeof import("../../lib/aiMediaVideoClientOptions.ts")>("lib/aiMediaVideoClientOptions.ts");
  const choices = options.getMediaVideoEngineQualityChoices();
  assert.equal(choices.some(choice => choice.engine === "wan3" || choice.engine === "minimax-h3" || choice.engine === "heygen"), false);
  assert.equal(choices.length, 13, "seven available engines retain thirteen native resolution choices");
  assert.deepEqual(new Set(choices.map(choice => choice.engine)), new Set(catalog.AI_MEDIA_AVAILABLE_VIDEO_MODELS.map(model => model.id)));
  const recommendation = load<typeof import("../../lib/aiMediaModelRecommendation.ts")>("lib/aiMediaModelRecommendation.ts");
  for (const recommendationContext of [undefined, "studio-free"] as const) for (const durationSeconds of [8, 20, 30]) {
    const engine = recommendation.recommendAiMediaModel({ kind: "video", durationSeconds, sceneMode: "single", brief: "Un jardin silencieux", language: "en", recommendationContext })?.engine;
    assert.equal(retiredEngines.some(retired => retired.engine === engine), false);
  }
});

test("Wan2.6 Flash and Wan2.7 keep both resolutions and valid photo requests in free Studio", () => {
  const load = runtime();
  const options = load<typeof import("../../lib/aiMediaVideoClientOptions.ts")>("lib/aiMediaVideoClientOptions.ts");
  const contracts = load<typeof Contracts>("lib/aiMediaGenerationContracts.ts");
  const quotes = load<typeof import("../../lib/aiMediaCreditQuoteServer.ts")>("lib/aiMediaCreditQuoteServer.ts");
  const catalog = load<typeof Catalog>("lib/aiMediaModelCatalog.ts");
  const choices = options.getMediaVideoEngineQualityChoices(false);
  for (const videoEngine of ["wan-flash", "wan27"] as const) for (const videoResolution of ["720p", "1080p"] as const) {
    assert.ok(choices.some(choice => choice.engine === videoEngine && choice.resolution === videoResolution));
    const request = contracts.normalizeAiMediaGenerationRequest({ requestId: "offline-other-wan-engines", kind: "video", creationMode: "free", source: "studio", operation: "generate", videoEngine, videoResolution, durationSeconds: 8, format: "landscape", freePrompt: "Un jardin paisible, sans paroles.", withNarration: false, teamVideoSpeechMode: "voiceover", teamVideoProviderConsent: true, identityConsent: true,
      inspirationImages: [{ mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9kAAAAASUVORK5CYII=", role: "inspiration", usage: "inspiration" }] });
    assert.equal(catalog.getAiMediaVideoEngineRetirementIssue(request.videoEngine), null);
    assert.equal(request.videoEngine, videoEngine); assert.equal(request.videoResolution, videoResolution);
    const quote = quotes.createAiMediaServerQuote("account", { ...request, inspirationImagesCount: request.inspirationImages.length });
    assert.equal(quote.engine, videoEngine); assert.equal(quote.resolution, videoResolution); assert.ok(quote.totalCredits > 0);
  }
});

test("all stale generation payloads are rejected before narration, quota reservation or provider", () => {
  const contracts = runtime()<typeof Contracts>("lib/aiMediaGenerationContracts.ts");
  const base = { requestId: "offline-speed-policy", source: "studio", creationMode: "free", operation: "generate", kind: "video", format: "landscape", videoEngine: "wan3", videoResolution: "720p", freePrompt: "Un jardin paisible sans texte.", withNarration: false };
  for (const { engine: videoEngine, resolution: videoResolution, reason } of retiredEngines) {
    for (const durationSeconds of [4, 8, 10, 15, 20, 30]) assert.throws(() => contracts.normalizeAiMediaGenerationRequest({ ...base, videoEngine, videoResolution, durationSeconds }), reason);
    for (const source of ["studio", "booster"]) assert.throws(() => contracts.normalizeAiMediaGenerationRequest({ ...base, videoEngine, videoResolution, creationMode: "guided", source, idea: "Une visite du jardin", durationSeconds: 30 }), reason);
  }
  const allowed = contracts.normalizeAiMediaGenerationRequest({ ...base, videoEngine: "grok-lite", durationSeconds: 30 });
  assert.equal(allowed.videoEngine, "grok-lite"); assert.equal(allowed.durationSeconds, 30);
});

test("server quote guard rejects retired engines in every context before pricing and preserves Wan2.7", () => {
  let prices = 0;
  const load = runtime({ "./aiMediaCreditsPricing.ts": { quoteAiMediaCredits: (input: Row) => { prices++; return { engine: input.videoEngine, totalCredits: 100 }; } } });
  const quotes = load<typeof import("../../lib/aiMediaCreditQuoteServer.ts")>("lib/aiMediaCreditQuoteServer.ts");
  for (const { engine: videoEngine, reason } of retiredEngines) for (const creationMode of ["free", "guided"] as const) {
    assert.throws(() => quotes.createAiMediaServerQuote("account", { kind: "video", creationMode, videoEngine, durationSeconds: 30 }), reason);
    assert.equal(prices, 0);
  }
  assert.equal(quotes.createAiMediaServerQuote("account", { kind: "video", creationMode: "guided", videoEngine: "wan27", durationSeconds: 8 }).engine, "wan27");
  assert.equal(prices, 1);
});

test("quote HTTP endpoint rejects retired engines before account quota reads and returns their distinct reasons", async () => {
  let downstreamReads = 0;
  const load = runtime({
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/multicompte/server": { getCurrentInrcyAccountScope: async () => ({ scope: { activeUserId: "account", authUserId: "actor" }, supabase: {} }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => { downstreamReads++; return "premium"; } },
    "@/lib/aiMediaGenerationQuota": { AiMediaGenerationQuotaError: class extends Error {}, getAiMediaQuotaSnapshot: async () => { downstreamReads++; return {}; } },
    "@/lib/aiUsageQuota": { isAdminUserForAi: async () => { downstreamReads++; return true; } },
    "@/lib/aiMediaVideoEntitlementServer": { getAiMediaVideoEntitlement: async () => { downstreamReads++; return {}; } },
  });
  const route = load<{ POST: (request: Request) => Promise<Response> }>("app/api/media-generation/quote/route.ts");
  for (const { engine: videoEngine, reason } of retiredEngines) {
    const result = await route.POST(new Request("https://app.inrcy.local/api/media-generation/quote", { method: "POST", body: JSON.stringify({ kind: "video", creationMode: "free", videoEngine, durationSeconds: 30 }) }));
    assert.equal(result.status, 400); const body = await result.json() as Row;
    assert.equal(body.code, "AI_MEDIA_VIDEO_ENGINE_RETIRED"); assert.match(String(body.error), reason); assert.equal(downstreamReads, 0);
  }
});

test("provider dispatcher refuses retired submissions before any factory and preserves history identity", async () => {
  let factories = 0, submissions = 0;
  const provider = { id: "offline", model: "offline", generate: async () => { submissions++; return { provider: "offline", model: "offline", clips: [], warnings: [], estimatedCostMicroUsd: 0 }; } };
  const load = runtime({ "@/lib/aiVideoProviderGoogleOmni": { googleOmniVideoProvider: provider }, "@/lib/aiVideoProviderGoogleVeo": { googleVeoVideoProvider: provider }, "./aiVideoProviderGateway.ts": { createGatewayAiVideoProvider: () => { factories++; return provider; } } });
  const api = load<typeof import("../../lib/aiVideoProvider.ts")>("lib/aiVideoProvider.ts");
  const input = { request: { kind: "video", source: "studio", creationMode: "free", videoEngine: "wan3" } } as unknown as Parameters<typeof api.generateOriginalAiVideoClips>[0];
  for (const { engine: videoEngine, reason } of retiredEngines) for (const creationMode of ["free", "guided"] as const) {
    await assert.rejects(api.generateOriginalAiVideoClips({ ...input, request: { ...input.request, videoEngine, creationMode, source: creationMode === "guided" ? "booster" : "studio" } }), reason);
    assert.equal(factories, 0); assert.equal(submissions, 0);
  }
  for (const { engine } of retiredEngines) assert.deepEqual(api.getAiVideoProviderIdentity(engine), { provider: "offline", model: "offline" });
  assert.equal(factories, 2); assert.equal(submissions, 0);
  await api.generateOriginalAiVideoClips({ ...input, request: { ...input.request, videoEngine: "wan27" } });
  assert.equal(factories, 3); assert.equal(submissions, 1);
});

test("assistant rejects combined duration/settings requests with either retired engine without partial changes", () => {
  const api = runtime({ ai: { tool: (definition: unknown) => definition, jsonSchema: (schema: unknown) => schema } }, true)<{ __parseInput: (input: unknown) => unknown }>("lib/inrAssistantMediaTools.ts");
  for (const { engine, reason } of retiredEngines) {
    const input = Object.freeze({ mediaType: "video", prompt: "Un jardin paisible", durationSeconds: 30, settings: Object.freeze([Object.freeze({ field: "withSubtitles", valueJson: "true" }), Object.freeze({ field: "videoEngine", valueJson: JSON.stringify(engine) })]) });
    const before = JSON.stringify(input); assert.throws(() => api.__parseInput(input), reason); assert.equal(JSON.stringify(input), before);
  }
});
