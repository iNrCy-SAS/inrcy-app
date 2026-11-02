import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

type Row = Record<string, unknown>;
type GatewayRequest = { model: string; body: { model: string; reasoning?: { effort: string }; max_output_tokens: number }; attempt: number; timeoutMs: number };
type HttpOptions = { body: string; retries: number; timeoutMs: number; deadlineAt: number; onAttempt?: (attempt: number) => Promise<void>; onAttemptSettled?: (result: { attempt: number; error?: Error; response?: Response; willRetry: boolean }) => Promise<void> };
const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);

// Run the real prompt, generation client, fallback chain, output validation and
// operation budget. Only HTTP and the Redis/accounting boundary are replaced.
function runtime(options: { publication?: boolean } = {}) {
  const publication = options.publication === true;
  let now = Date.parse("2026-10-30T12:00:00Z");
  const startedAt = now;
  const requests: GatewayRequest[] = [];
  const accounting = { reserved: 0, committed: 0, rolledBack: 0 };
  const cache = new Map<string, Row>();
  const quiet = { info() {}, warn() {}, error() {} };
  const payload = { versions: { facebook: {
    title: "Préparez votre projet avec nous",
    content: "Un projet commence par un échange concret. Prenez le temps de préciser vos besoins et vos attentes pour préparer chaque étape avec notre équipe.",
    cta: "", hashtags: [],
  } } };
  const config = {
    cleanAiGatewayEnv: (value: unknown) => String(value || "").trim(),
    getAiGatewayCredential: () => "synthetic-test-credential",
    normalizeAiGatewayBaseUrl: () => "https://gateway.invalid/v1",
    normalizeGatewayModelId: (value: unknown) => String(value || "").trim(),
  };
  const overrides: Row = {
    "lib/aiGatewayConfig.ts": config,
    "lib/aiGatewayAccountGuard.ts": {
      reserveAiGatewayAccountAttempt: async () => { accounting.reserved++; return {}; },
      commitAiGatewayAccountAttempt: async () => { accounting.committed++; },
      rollbackAiGatewayAccountAttempt: async () => { accounting.rolledBack++; },
      recordAiGatewayAccountFailure: async () => undefined,
    },
    "lib/aiGatewayOperationTelemetry.ts": { recordAiGatewayOperationCall() {} },
    "lib/observability/fetch.ts": {
      fetchWithRetry: async (_url: string, options: HttpOptions) => {
        const body = JSON.parse(options.body);
        for (let attempt = 0; attempt <= options.retries; attempt++) {
          await options.onAttempt?.(attempt);
          requests.push({ model: body.model, body, attempt, timeoutMs: options.timeoutMs });
          if (body.model.startsWith("anthropic/")) {
            now = Math.min(now + options.timeoutMs, options.deadlineAt);
            const error = new Error("Request timed out after 50000 ms.");
            await options.onAttemptSettled?.({ attempt, error, willRetry: attempt < options.retries });
            if (attempt < options.retries) continue;
            throw error;
          }
          now += 1_000;
          const stats = { globalSummary: "Le rapport complet présente les résultats disponibles sans inventer de chiffres.", strengths: ["Les canaux connectés restent disponibles pour communiquer."], weaknesses: [], recommendations: [], channelNotes: {} };
          const complete = !body.model.startsWith("google/") || body.reasoning?.effort === "low";
          const response = Response.json({
            status: complete ? "completed" : "incomplete",
            ...(complete ? {} : { incomplete_details: { reason: "max_output_tokens" } }),
            output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: complete ? JSON.stringify(body.model.startsWith("google/") && !publication ? stats : payload) : '{"globalSummary":"unfinished' }] }],
            usage: { input_tokens: 100, output_tokens: complete ? 100 : 1285, total_tokens: complete ? 200 : 1385 },
          });
          await options.onAttemptSettled?.({ attempt, response, willRetry: false });
          return response;
        }
        throw new Error("unreachable");
      },
    },
  };
  const routeDependencies: Row = {
    "@/lib/aiWritingProfile": {
      buildAiLanguageInstruction: () => "Réponds en français.",
      buildAiWritingProfilePromptSection: () => "Style simple.",
      buildAiWritingProfileRules: () => "N'invente aucun résultat.",
      getAiEngineTemperature: () => .2,
    },
    "@/lib/aiProfessionalGenerationContext": { buildAiProfessionalBusinessPromptPayload: () => ({}) },
  };
  class Clock extends Date {
    constructor(value?: string | number | Date) { super(value === undefined ? now : value instanceof Date ? value.getTime() : value); }
    static now() { return now; }
  }
  function load(relative: string): Row {
    const file = path.resolve(root, relative);
    const key = path.relative(root, file).replaceAll("\\", "/");
    if (key in overrides) return overrides[key] as Row;
    if (cache.has(file)) return cache.get(file)!;
    const extra = key === "lib/boosterPublishGeneration.ts"
      ? "\nexport { generateVersions as testGenerateVersions };"
      : key === "app/api/agent/actions/send-stats-report/route.ts"
      ? "\nexport { generateAiInsights as testGenerateAiInsights };" : "";
    const code = ts.transpileModule(readFileSync(file, "utf8") + extra, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const moduleRecord = { exports: {} as Row }; cache.set(file, moduleRecord.exports);
    const require = (id: string): unknown => {
      if (id === "server-only") return {};
      // The report's PDF, auth and email exports are outside this editorial unit.
      if (key.startsWith("app/api/agent/actions/send-stats-report/")) {
        if (id in routeDependencies) return routeDependencies[id];
        if (!["@/lib/aiGatewayClient", "@/lib/aiGatewayPolicy"].includes(id)) return {};
      }
      if (!id.startsWith("@/") && !id.startsWith(".")) return nativeRequire(id);
      const base = id.startsWith("@/") ? path.resolve(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      assert.ok(target, id);
      return load(target);
    };
    new Function("module", "exports", "require", "process", "console", "Date", code)(moduleRecord, moduleRecord.exports, require, { env: {} }, quiet, Clock);
    cache.set(file, moduleRecord.exports);
    return moduleRecord.exports;
  }
  return { load, requests, accounting, elapsed: () => now - startedAt, payload };
}

test("a slow text-only Booster provider leaves time for the different-provider fallback within the original budget", async () => {
  const h = runtime();
  const policy = h.load("lib/aiGatewayPolicy.ts") as typeof import("../../lib/aiGatewayPolicy.ts");
  const budget = policy.createAiOperationBudget("booster.publish");
  const profile = (h.load("lib/aiGenerationProfile.ts") as typeof import("../../lib/aiGenerationProfile.ts")).buildNormalizedAiGenerationProfile({ business: {}, idea: "Préparer mon projet" });
  profile.preferences.engine = "anthropic";
  const generation = h.load("lib/boosterPublishGeneration.ts") as { testGenerateVersions: (args: unknown) => Promise<{ versions: { facebook: { title: string } } }> };
  const result = await generation.testGenerateVersions({
    idea: "Préparer mon projet", theme: "conseil", style: "equilibre", channels: ["facebook"], profile: {}, business: {},
    generationProfile: profile, aiFeature: "booster.publish", accountId: "account-test", budget,
  });
  assert.equal(result.versions.facebook.title, h.payload.versions.facebook.title);
  assert.equal(h.requests.length, 2);
  assert.match(h.requests[0].model, /^anthropic\//);
  assert.match(h.requests[1].model, /^openai\//);
  assert.deepEqual(h.requests.map(request => request.attempt), [0, 0]);
  assert.ok(h.elapsed() < budget.maxDurationMs);
  assert.equal(budget.calls, 1, "provider recovery remains one logical product action");
  assert.deepEqual(h.accounting, { reserved: 2, committed: 1, rolledBack: 1 });
});

for (const feature of ["booster.publish", "agent.publish"] as const) {
  test(`${feature} preserves its JSON output allowance on Gemini without a provider fallback`, async () => {
    const h = runtime({ publication: true });
    const policy = h.load("lib/aiGatewayPolicy.ts") as typeof import("../../lib/aiGatewayPolicy.ts");
    const budget = policy.createAiOperationBudget(feature);
    const profile = (h.load("lib/aiGenerationProfile.ts") as typeof import("../../lib/aiGenerationProfile.ts")).buildNormalizedAiGenerationProfile({ business: {}, idea: "Préparer mon projet" });
    profile.preferences.engine = "google";
    const generation = h.load("lib/boosterPublishGeneration.ts") as { testGenerateVersions: (args: unknown) => Promise<{ versions: { facebook: { title: string } } }> };
    const result = await generation.testGenerateVersions({
      idea: "Préparer mon projet", theme: "conseil", style: "equilibre", channels: ["facebook"], profile: {}, business: {},
      generationProfile: profile, aiFeature: feature, accountId: "account-test", budget,
    });
    assert.equal(result.versions.facebook.title, h.payload.versions.facebook.title);
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].model, "google/gemini-3-flash");
    assert.deepEqual(h.requests[0].body.reasoning, { effort: "low" });
    assert.ok(h.requests[0].body.max_output_tokens <= policy.getAiFeaturePolicy(feature).maxOutputTokens);
    assert.equal(budget.calls, 1);
    assert.deepEqual(h.accounting, { reserved: 1, committed: 1, rolledBack: 0 });
  });
}

test("stats reports retain their bounded policy allowance and produce complete JSON before needing a fallback", async () => {
  const h = runtime();
  const report = { edition: "standard", periodDays: 30, channels: [], mail: null, badge: null, totals: { connectedChannels: 0, statsConnectedChannels: 0, opportunities: 0, capturedLeadsMonth: 0, estimatedValue: 0 } };
  const route = h.load("app/api/agent/actions/send-stats-report/route.ts") as { testGenerateAiInsights: (report: unknown, profile: unknown, accountId: string) => Promise<{ globalSummary: string }> };
  const result = await route.testGenerateAiInsights(report, { preferences: { engine: "google" } }, "account-test");
  assert.match(result.globalSummary, /rapport complet/);
  assert.equal(h.requests.length, 1, "short output must complete on the selected Google engine");
  assert.deepEqual(h.requests[0].body.reasoning, { effort: "low" });
  assert.equal(h.requests[0].body.max_output_tokens, (h.load("lib/aiGatewayPolicy.ts") as typeof import("../../lib/aiGatewayPolicy.ts")).getAiFeaturePolicy("agent.stats-report").maxOutputTokens);
  assert.equal(h.requests[0].body.max_output_tokens, 1800, "the approved policy ceiling is unchanged");
  assert.deepEqual(h.accounting, { reserved: 1, committed: 1, rolledBack: 0 });
});
