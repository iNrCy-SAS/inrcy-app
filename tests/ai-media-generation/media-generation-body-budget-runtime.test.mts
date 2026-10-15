import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as transport from "../../lib/aiMediaGenerationTransport.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";

function route() {
  let reservations = 0;
  const generations: contracts.AiMediaGenerationRequest[] = [];
  const quota = { creditsReady: true, credits: { remaining: 100 } };
  class TestError extends Error {}
  const modules = new Map<string, unknown>([
    ["next/server", { after() {}, NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaCompositionRecovery", {}],
    ["@/lib/aiMediaGenerationTransport", transport],
    ["@/lib/aiMediaGenerationPublicErrors", publicErrors],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: TestError, AiGatewayGuardUnavailableError: TestError }],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test" }],
    ["@/lib/aiMediaFreeGenerationPrompt", { AI_MEDIA_FREE_PROMPT_VERSION: "test-free" }],
    ["@/lib/aiMediaGenerationQuota", {
      AiMediaGenerationQuotaError: TestError,
      createAiMediaRequestFingerprint: () => "test-fingerprint",
      reserveAiMediaGeneration: async () => { reservations++; return { outcome: "reserved", jobId: "test-job" }; },
      completeAiMediaGeneration: async () => undefined,
      failAiMediaGeneration: async () => assert.fail("these requests must succeed or fail before reservation"),
      getAiMediaQuotaSnapshot: async () => quota,
    }],
    ["@/lib/aiMediaQuotaPresentation", { AI_MEDIA_ADMIN_LIMIT_OVERRIDE: 999999, presentAiMediaQuota: () => quota, presentAiMediaQuotaCounter: () => quota }],
    ["@/lib/aiUsageQuota", { isAdminUserForAi: async () => false }],
    ["@/lib/aiMediaGenerationServer", { generateAndSaveAiMedia: async (args: { request: contracts.AiMediaGenerationRequest }) => {
      generations.push(args.request);
      return { item: { id: "test-image" }, soundtrack: null, model: "mock", promptVersion: "test", promptSha256: "test", pipelineTimingsMs: {} };
    } }],
    ["@/lib/aiMediaSensitiveText", { safeAiMediaErrorDetails: () => [], safeAiMediaErrorMessage: () => "error" }],
    ["@/lib/aiGeneratedMediaRegistry", { getPersistedGeneratedAiMediaId: async () => null, getExistingGeneratedAiMedia: async () => null }],
    ["@/lib/dashboardEditionServer", { getDashboardEditionForAccountId: async () => "standard" }],
    ["@/lib/aiMediaVideoEntitlementServer", { getAiMediaVideoEntitlement: async () => ({ maxDurationSeconds: 30 }) }],
    ["@/lib/multicompte/server", { getCurrentInrcyAccountScope: async () => ({ scope: { activeUserId: "account-a", authUserId: "actor-a" }, supabase: {} }) }],
    ["@/lib/rateLimit", { enforceRateLimit: async () => null }],
    ["@/lib/aiMediaCreditQuoteServer", { quoteAiMediaRequest: () => ({ totalCredits: 7, tariffVersion: "test", quoteId: "test", breakdown: [] }), assertAiMediaCreditQuote: () => true }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../app/api/media-generation/generate/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", "console", output)(record, record.exports, (id: string) => {
    assert.ok(modules.has(id), `unmocked route dependency: ${id}`);
    return modules.get(id);
  }, { info() {}, error() {}, warn() {} });
  return {
    generations,
    reservations: () => reservations,
    post: (body: string, headers: Record<string, string> = {}) => record.exports.POST(new Request("https://inrcy.test/api/media-generation/generate", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
    })),
  };
}

function fiveReferences(encodedLength: number) {
  return {
    contractVersion: 4, requestId: "body-budget-runtime-0001", source: "studio", operation: "generate",
    creationMode: "free", kind: "image", format: "portrait", imageEngine: "openai",
    freePrompt: "é".repeat(contracts.AI_MEDIA_FREE_PROMPT_MAX_CHARS),
    identityReferenceSetId: "c12eb908-30c5-45f4-9aac-e09df881879c", identityConsent: true,
    inspirationImages: Array.from({ length: 5 }, () => ({ mimeType: "image/jpeg", data: "A".repeat(encodedLength), name: "é".repeat(120), role: "inspiration", usage: "inspiration" })),
  };
}

test("five references near the browser byte cap pass the real generation route without being lost", async () => {
  const length = 4 * Math.ceil(contracts.AI_MEDIA_INSPIRATION_NORMALIZED_MAX_BYTES / 3);
  const serialized = JSON.stringify(fiveReferences(length));
  assert.ok(Buffer.byteLength(serialized) > 3 * 1024 * 1024, "regression: the previous route rejected this valid five-image request");
  assert.ok(Buffer.byteLength(serialized) < contracts.AI_MEDIA_GENERATION_MAX_BODY_BYTES);
  const current = route();
  const response = await current.post(serialized);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(current.reservations(), 1);
  assert.equal(current.generations.length, 1);
  assert.equal(current.generations[0].inspirationImages.length, 5);
  assert.ok(current.generations[0].inspirationImages.every((image) => image.data.length === length));
});

test("the five largest contract references plus a UTF-8 brief fit the shared request budget", async () => {
  const serialized = JSON.stringify(fiveReferences(contracts.AI_MEDIA_INSPIRATION_MAX_IMAGE_BASE64_CHARS));
  assert.ok(Buffer.byteLength(serialized) < contracts.AI_MEDIA_GENERATION_MAX_BODY_BYTES);
  const current = route();
  const response = await current.post(serialized);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(current.generations[0].inspirationImages.length, 5);
});

test("an oversized body is rejected before any reservation or provider, even with absent or false Content-Length", async () => {
  const base = { ...fiveReferences(64), extra: "" };
  const minimumBytes = Buffer.byteLength(JSON.stringify(base));
  const atLimit = JSON.stringify({ ...base, extra: "x".repeat(contracts.AI_MEDIA_GENERATION_MAX_BODY_BYTES - minimumBytes) });
  assert.equal(Buffer.byteLength(atLimit), contracts.AI_MEDIA_GENERATION_MAX_BODY_BYTES);
  const allowed = route();
  assert.equal((await allowed.post(atLimit)).status, 200);
  for (const headers of [{}, { "content-length": "1" }] as Array<Record<string, string>>) {
    const current = route();
    const oversized = atLimit + " ";
    const response = await current.post(oversized, headers);
    assert.equal(response.status, 400);
    assert.equal(current.reservations(), 0);
    assert.equal(current.generations.length, 0);
  }
  const declared = route();
  assert.equal((await declared.post(JSON.stringify(base), { "content-length": String(contracts.AI_MEDIA_GENERATION_MAX_BODY_BYTES + 1) })).status, 400);
  assert.equal(declared.reservations(), 0);
  assert.equal(declared.generations.length, 0);
});
