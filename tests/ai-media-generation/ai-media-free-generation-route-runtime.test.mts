import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import * as creditPricing from "../../lib/aiMediaCreditsPricing.ts";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { createAiMediaRequestFingerprint } from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";
import { AiJsonResponseNormalizationError } from "../../lib/aiJsonResponseNormalization.ts";
import * as generationTransport from "../../lib/aiMediaGenerationTransport.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";

const quoteOutput = ts.transpileModule(readFileSync(new URL("../../lib/aiMediaCreditQuoteServer.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const quoteRecord = { exports: {} as {
  quoteAiMediaRequest: (account: string, request: contracts.AiMediaGenerationRequest) => { totalCredits: number; tariffVersion: string; quoteId: string };
} };
new Function("module", "exports", "require", quoteOutput)(quoteRecord, quoteRecord.exports, (id: string) => {
  if (id === "server-only") return {};
  if (id === "node:crypto") return crypto;
  if (id === "./aiMediaCreditsPricing.ts") return creditPricing;
  throw new Error(`Unisolated quote dependency: ${id}`);
});

type ReservationCall = {
  accountId: string; actorAuthUserId: string; requestKey: string;
  requestFingerprint: string; mediaKind: string; surface: string; quotaAmount: number; quotaUnit: string;
};

function loadRoute(options: { authenticated?: boolean; authentication?: Promise<void>; cancelledKey?: string; cancellationConflictKey?: string; providerFails?: boolean; providerError?: Error; quotaReached?: boolean; maximumDuration?: number; creditsReady?: boolean; preparation?: Promise<void>; work?: Promise<void>; checkpoint?: "saved" | "lost_ack" | "unavailable"; compositionFails?: boolean; cleanupFails?: boolean } = {}) {
  const reservationCalls: ReservationCall[] = [];
  const generationCalls: Array<{ request: contracts.AiMediaGenerationRequest; accountId: string; jobId: string; signal?: AbortSignal }> = [];
  const lifetimes: Promise<unknown>[] = [];
  let authenticationCalls = 0;
  let paidCalls = 0;
  const completionCalls: unknown[] = [];
  const failureCalls: unknown[] = [];
  const releasedCheckpoints: unknown[] = [];
  const completedRequests = new Map<string, { fingerprint: string; jobId: string }>();
  const pendingRequests = new Map<string, { fingerprint: string; jobId: string }>();
  const item = {
    id: "generated-media-test-id", media_type: "image", signed_url: "https://example.invalid/result.jpg",
  };
  const quota = { image: { remaining: 19 }, video: { remaining: 24 }, credits: { remaining: 560 }, creditsReady: options.creditsReady !== false };
  class AccountLimitError extends Error {}
  class GuardUnavailableError extends Error {}
  class QuotaError extends Error {}
  const modules = new Map<string, unknown>([
    ["@/lib/aiMediaGenerationPublicErrors", publicErrors],
    ["@/lib/aiMediaCompositionRecovery", {
      persistAiMediaCompositionCheckpoint: async (args: Record<string, unknown>) => {
        if (options.checkpoint !== "saved") throw new Error("checkpoint unavailable");
        return { accountId: args.accountId, jobId: args.jobId, leaseToken: "lease-a" };
      },
      hasAiMediaCompositionCheckpoint: async () => options.checkpoint === "lost_ack",
      releaseAiMediaCompositionCheckpoint: async (args: unknown) => { releasedCheckpoints.push(args); },
      finishAiMediaCompositionCheckpoint: async () => { if (options.cleanupFails) throw new Error("cleanup unavailable"); },
    }],
    ["next/server", { after: (task: Promise<unknown>) => { lifetimes.push(task); }, NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/aiMediaGenerationTransport", generationTransport],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: AccountLimitError, AiGatewayGuardUnavailableError: GuardUnavailableError }],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaCreditQuoteServer", quoteRecord.exports],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test-version" }],
    ["@/lib/aiMediaFreeGenerationPrompt", { AI_MEDIA_FREE_PROMPT_VERSION: "test-free-version" }],
    ["@/lib/aiMediaGenerationQuota", {
      AiMediaGenerationQuotaError: QuotaError,
      createAiMediaRequestFingerprint,
      reserveAiMediaGeneration: async (args: ReservationCall) => {
        reservationCalls.push(args);
        if (options.cancellationConflictKey === args.requestKey) throw Object.assign(new QuotaError("Cette tentative a été fermée avant sa réservation."), { code: "AI_MEDIA_IDEMPOTENCY_CONFLICT", httpStatus: 409 });
        if (options.cancelledKey === args.requestKey) return { outcome: "replayed", status: "failed", jobId: "cancelled-job-a" };
        if (options.quotaReached) return { outcome: "quota_reached", quota: { remaining: 0 } };
        const completed = completedRequests.get(args.requestKey);
        if (completed) {
          assert.equal(args.requestFingerprint, completed.fingerprint, "Un rejeu doit porter le même contrat.");
          return { outcome: "replayed", status: "completed", jobId: completed.jobId };
        }
        const jobId = `job-${pendingRequests.size + 1}`;
        pendingRequests.set(args.requestKey, { fingerprint: args.requestFingerprint, jobId });
        return { outcome: "reserved", status: "reserved", jobId };
      },
      completeAiMediaGeneration: async (args: { jobId: string }) => {
        completionCalls.push(args);
        for (const [key, value] of pendingRequests) if (value.jobId === args.jobId) completedRequests.set(key, value);
      },
      failAiMediaGeneration: async (args: unknown) => { failureCalls.push(args); },
      getAiMediaQuotaSnapshot: async () => quota,
    }],
    ["@/lib/aiMediaQuotaPresentation", {
      AI_MEDIA_ADMIN_LIMIT_OVERRIDE: 999_999,
      presentAiMediaQuota: (value: unknown) => value,
      presentAiMediaQuotaCounter: (value: unknown) => value,
    }],
    ["@/lib/aiUsageQuota", { isAdminUserForAi: async () => false }],
    ["@/lib/aiMediaGenerationServer", {
      generateAndSaveAiMedia: async (args: { request: contracts.AiMediaGenerationRequest; accountId: string; jobId: string; signal?: AbortSignal; onBillableWorkStarted?: () => void | Promise<void>; onCompositionReady?: (args: unknown) => Promise<void> }) => {
        generationCalls.push(args);
        await options.preparation;
        args.signal?.throwIfAborted();
        await args.onBillableWorkStarted?.();
        paidCalls += 1;
        if (options.checkpoint) await args.onCompositionReady?.({ input: {}, metadata: {} });
        if (options.compositionFails) throw new Error("ffmpeg timeout");
        await options.work;
        if (options.providerError) throw options.providerError;
        if (options.providerFails) throw new Error("ai_image_provider_output_invalid");
        return { item, soundtrack: null, model: "mock-provider", videoEngineResult: null,
          promptVersion: "mock-prompt", promptSha256: "mock-hash", pipelineTimingsMs: {} };
      },
    }],
    ["@/lib/aiMediaSensitiveText", sensitiveText],
    ["@/lib/aiGeneratedMediaRegistry", {
      getPersistedGeneratedAiMediaId: async () => completedRequests.size ? item.id : null,
      getExistingGeneratedAiMedia: async () => completedRequests.size ? item : null,
    }],
    ["@/lib/dashboardEditionServer", { getDashboardEditionForAccountId: async () => "standard" }],
    ["@/lib/aiMediaVideoEntitlementServer", { getAiMediaVideoEntitlement: async () => ({ maxDurationSeconds: options.maximumDuration ?? 30 }) }],
    ["@/lib/multicompte/server", {
      getCurrentInrcyAccountScope: async () => {
        authenticationCalls += 1;
        await options.authentication;
        return options.authenticated === false ? null : {
          scope: { activeUserId: "active-account-test", authUserId: "actor-test" }, supabase: {},
        };
      },
    }],
    ["@/lib/rateLimit", { enforceRateLimit: async () => null }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../app/api/media-generation/generate/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", "console", output)(record, record.exports, (specifier: string) => {
    assert.ok(modules.has(specifier), `Dépendance non isolée dans le test de route : ${specifier}`);
    return modules.get(specifier);
  }, { info() {}, warn() {}, error() {} });
  return {
    reservationCalls, generationCalls, completionCalls, failureCalls, lifetimes, releasedCheckpoints,
    paidCalls: () => paidCalls, authenticationCalls: () => authenticationCalls,
    post: (body: unknown, init: RequestInit = {}) => record.exports.POST(new Request("https://example.invalid/api/media-generation/generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init,
    })),
  };
}

function body(overrides: Record<string, unknown> = {}) {
  const input = {
    contractVersion: 4, requestId: "free-route-runtime-0001", source: "studio", operation: "generate",
    creationMode: "free", kind: "image", format: "square",
    freePrompt: "Une affiche violette avec le texte exact : 21 jours gratuits.",
    ...overrides,
  };
  try {
    const quote = quoteRecord.exports.quoteAiMediaRequest("active-account-test", contracts.normalizeAiMediaGenerationRequest(input));
    return { expectedCredits: quote.totalCredits, creditTariffVersion: quote.tariffVersion, creditQuoteId: quote.quoteId, ...input };
  } catch { return input; }
}

test("les créations libres passent par la même authentification avant tout débit", async () => {
  const route = loadRoute({ authenticated: false });
  const response = await route.post(body());
  assert.equal(response.status, 401);
  assert.equal(route.reservationCalls.length, 0);
  assert.equal(route.generationCalls.length, 0);
});

test("generation persists the same safe actionable cause that status recovery will return", async () => {
  for (const [error, code] of [
    [new Error("ai_media_narration_unavailable:La voix off est trop longue pour cette durée."), "AI_MEDIA_NARRATION_TOO_LONG"],
    [new Error("ai_video_omni_rate_limited:Your project has exceeded its monthly spending cap. https://private.invalid/?token=secret"), "AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED"],
    [new Error("Invalid resolution: 720x1280"), "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED"],
    [new Error("ai_media_generated_narration_invalid"), "AI_MEDIA_GENERATED_NARRATION_INVALID"],
  ] as const) {
    const route = loadRoute({ providerError: error }); const response = await route.post(body()); const payload = await response.json();
    assert.equal(payload.code, code); assert.equal(payload.error, publicErrors.getAiMediaGenerationPublicError(error).message);
    assert.equal(route.failureCalls.length, 1); assert.equal(route.completionCalls.length, 0); assert.equal(route.generationCalls.length, 1);
    const failure = route.failureCalls[0] as { errorCode: string; errorMessage: string };
    assert.equal(failure.errorCode, payload.code); assert.equal(failure.errorMessage, payload.error);
    assert.doesNotMatch(JSON.stringify(payload), /https:|token|secret|720x1280|monthly spending cap/);
  }
});

test("a preparation stop while authentication is delayed cannot create a later reservation or paid call", async () => {
  let releaseAuth!: () => void;
  const route = loadRoute({ authentication: new Promise<void>((resolve) => { releaseAuth = resolve; }) });
  const controller = new AbortController();
  const task = route.post(body(), { signal: controller.signal, headers: { "Content-Type": "application/json", Accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE } });
  controller.abort(); releaseAuth();
  const response = await generationTransport.readAiMediaGenerationResponse(await task, () => { assert.fail("An aborted preparation cannot lock billing"); });
  assert.equal(response.status, 499); assert.equal(route.reservationCalls.length, 0); assert.equal(route.paidCalls(), 0); assert.equal(route.completionCalls.length, 0);
});

test("a durable cancelled request key cannot start paid work even when the original disconnect signal was lost", async () => {
  const input = body(); const route = loadRoute({ cancelledKey: input.requestId as string });
  const response = await route.post(input); const payload = await response.json();
  assert.equal(response.status, 409); assert.equal(payload.code, "AI_MEDIA_REQUEST_ALREADY_CLOSED");
  assert.equal(route.paidCalls(), 0); assert.equal(route.generationCalls.length, 0); assert.equal(route.completionCalls.length, 0); assert.equal(route.failureCalls.length, 0);
});

test("the live v3 tombstone fingerprint conflict rejects the original request before any provider or quota finalization", async () => {
  const input = body(); const route = loadRoute({ cancellationConflictKey: input.requestId as string });
  const response = await route.post(input); const payload = await response.json();
  assert.equal(response.status, 409); assert.equal(payload.code, "AI_MEDIA_IDEMPOTENCY_CONFLICT");
  assert.equal(route.paidCalls(), 0); assert.equal(route.generationCalls.length, 0); assert.equal(route.completionCalls.length, 0); assert.equal(route.failureCalls.length, 0);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise((resolve) => setImmediate(resolve)); };
const streamHeaders = { "Content-Type": "application/json", Accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE };

test("streaming emits the real paid-work lock before the result and authenticates once", async () => {
  const work = deferred();
  const route = loadRoute({ work: work.promise });
  const response = await route.post(body(), { headers: streamHeaders });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /application\/x-ndjson/);
  const reader = response.body!.getReader();
  assert.deepEqual(JSON.parse(new TextDecoder().decode((await reader.read()).value)), { type: "billing_locked" });
  await flush();
  assert.equal(route.paidCalls(), 1);
  assert.equal(route.completionCalls.length, 0);
  work.resolve();
  const result = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal(result.type, "result"); assert.equal(result.status, 200); assert.equal(result.payload.ok, true);
  assert.equal((await reader.read()).done, true);
  assert.equal(route.authenticationCalls(), 1);
  await Promise.all(route.lifetimes);
  assert.equal(route.completionCalls.length, 1);
});

test("cancellation during preparation releases the reservation without a paid call", async () => {
  const preparation = deferred();
  const route = loadRoute({ preparation: preparation.promise });
  const client = new AbortController();
  const response = await route.post(body(), { headers: streamHeaders, signal: client.signal });
  await flush();
  assert.equal(route.generationCalls.length, 1);
  client.abort(); preparation.resolve();
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.length, 1); assert.equal(events[0].type, "result"); assert.equal(events[0].status, 499);
  assert.equal(events[0].payload.code, "AI_MEDIA_GENERATION_CANCELLED");
  assert.equal(route.paidCalls(), 0); assert.equal(route.failureCalls.length, 1); assert.equal(route.completionCalls.length, 0);
});

test("disconnect after the paid gate leaves one independent job to persist and finalize", async () => {
  const work = deferred();
  const route = loadRoute({ work: work.promise });
  const client = new AbortController();
  const response = await route.post(body(), { headers: streamHeaders, signal: client.signal });
  const reader = response.body!.getReader();
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type, "billing_locked");
  client.abort(); await reader.cancel();
  assert.equal(route.generationCalls[0].signal?.aborted, false);
  work.resolve(); await Promise.all(route.lifetimes);
  assert.equal(route.paidCalls(), 1); assert.equal(route.completionCalls.length, 1); assert.equal(route.failureCalls.length, 0);
  const replay = await route.post(body());
  assert.equal((await replay.json()).replayed, true); assert.equal(route.paidCalls(), 1);
});

test("a client stop before reading the billing frame cannot cancel the server job that already crossed its gate", async () => {
  const work = deferred(); const route = loadRoute({ work: work.promise }); const client = new AbortController();
  const response = await route.post(body(), { headers: streamHeaders, signal: client.signal });
  await flush(); assert.equal(route.paidCalls(), 1);
  // No body reader has received billing_locked yet: the server boundary alone
  // decides whether the supplier execution remains cancellable.
  client.abort(); assert.equal(route.generationCalls[0].signal?.aborted, false);
  work.resolve(); await Promise.all(route.lifetimes);
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].type, "billing_locked"); assert.equal(events[1].payload.ok, true);
  assert.equal(route.completionCalls.length, 1); assert.equal(route.failureCalls.length, 0);
  const replay = await route.post(body()); assert.equal((await replay.json()).replayed, true); assert.equal(route.paidCalls(), 1);
});

test("legacy JSON also detaches client abort after paid work while wrong Accept and unauthenticated responses keep JSON", async () => {
  const work = deferred(); const route = loadRoute({ work: work.promise }); const client = new AbortController();
  const responseTask = route.post(body(), { headers: { Accept: "application/json" }, signal: client.signal });
  await flush(); assert.equal(route.paidCalls(), 1); client.abort(); work.resolve();
  const response = await responseTask;
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.equal(route.generationCalls[0].signal?.aborted, false);
  for (const accept of ["application/json", "text/event-stream", "application/x-ndjson;q=0"]) {
    const legacy = loadRoute(); const reply = await legacy.post(body(), { headers: { Accept: accept } });
    assert.match(reply.headers.get("content-type") || "", /application\/json/); assert.equal((await reply.json()).ok, true);
  }
  const anonymous = loadRoute({ authenticated: false });
  const denied = await anonymous.post(body(), { headers: streamHeaders });
  assert.equal(denied.status, 401); assert.match(denied.headers.get("content-type") || "", /application\/json/);
  assert.deepEqual(await denied.json(), { ok: false, code: "UNAUTHORIZED", error: "Non authentifié." });
  assert.equal(anonymous.paidCalls(), 0); assert.equal(anonymous.reservationCalls.length, 0);
});

test("stream errors carry only the existing public message and preserve their HTTP status", async () => {
  const route = loadRoute({ providerError: new Error("private failure https://provider.invalid/private-key diagnostics") });
  const response = await route.post(body(), { headers: streamHeaders });
  let locks = 0;
  const result = await generationTransport.readAiMediaGenerationResponse(response, () => { locks += 1; });
  assert.equal(locks, 1); assert.equal(result.status, 502); assert.equal(result.ok, false);
  assert.equal((result.payload as { code: string }).code, "AI_MEDIA_GENERATION_FAILED");
  assert.doesNotMatch(JSON.stringify(result.payload), /provider.invalid|private-key|diagnostics/);
  assert.equal(route.failureCalls.length, 1);
});

test("un devis falsifié, périmé ou d'un autre compte bloque tout appel et tout débit", async () => {
  for (const overrides of [{ expectedCredits: 1 }, { creditTariffVersion: "ancienne-version" }, { creditQuoteId: "autre-compte" }]) {
    const route = loadRoute();
    const response = await route.post(body(overrides));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "AI_MEDIA_CREDIT_QUOTE_CHANGED");
    assert.equal(route.reservationCalls.length, 0);
    assert.equal(route.generationCalls.length, 0);
  }
});

test("une migration absente bloque avant le fournisseur, même avec un devis valide", async () => {
  const route = loadRoute({ creditsReady: false });
  const response = await route.post(body());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "AI_MEDIA_CREDITS_NOT_READY");
  assert.equal(route.reservationCalls.length, 0);
  assert.equal(route.generationCalls.length, 0);
});

test("chaque fournisseur accepte une durée compatible avec deux clips maximum et débite le devis du serveur", async () => {
  for (const [videoEngine, durationSeconds, expectedCredits] of [["grok-lite", 4, 19], ["grok", 30, 428], ["omni", 20, 207], ["veo", 16, 167], ["minimax-h3", 30, 247], ["wan3", 30, 307], ["veo-lite", 16, 87]] as const) {
    const route = loadRoute({ maximumDuration: 30 });
    const response = await route.post(body({ kind: "video", videoEngine, durationSeconds }));
    assert.equal(response.status, 200, await response.text());
    assert.equal(route.reservationCalls[0]!.quotaAmount, expectedCredits);
    assert.equal(route.reservationCalls[0]!.quotaUnit, "credit");
    assert.equal(route.generationCalls[0]!.request.videoEngine, videoEngine);
    assert.equal(route.generationCalls[0]!.request.durationSeconds, durationSeconds);
  }
});

test("les durées natives inférieures à quatre secondes restent refusées avant tout appel payant", async () => {
  for (const durationSeconds of [1, 2, 3]) {
    const route = loadRoute();
    const response = await route.post(body({ kind: "video", videoEngine: "grok-lite", durationSeconds }));
    assert.equal(response.status, 400);
    assert.equal(route.reservationCalls.length, 0);
    assert.equal(route.generationCalls.length, 0);
  }
});

test("un prompt Libre invalide est rejeté avant la réservation et l'appel fournisseur", async () => {
  const route = loadRoute();
  for (const freePrompt of ["", "ab", "x".repeat(contracts.AI_MEDIA_FREE_PROMPT_MAX_CHARS + 1), {}]) {
    const response = await route.post(body({ freePrompt }));
    assert.equal(response.status, 400);
  }
  assert.equal(route.reservationCalls.length, 0);
  assert.equal(route.generationCalls.length, 0);
  assert.equal(route.failureCalls.length, 0);
});

test("Libre et Guidé partagent les crédits d’établissement, pour les images et les vidéos", async () => {
  for (const creationMode of ["free", "guided"]) for (const kind of ["image", "video"]) {
    const route = loadRoute();
    const response = await route.post(body({
      creationMode, kind, durationSeconds: kind === "video" ? 20 : undefined,
      subjectSource: "custom", idea: "Un paysage coloré et original.", inputMode: "essential",
    }));
    assert.equal(response.status, 200, `${creationMode}/${kind}: ${await response.text()}`);
    assert.equal(route.reservationCalls.length, 1);
    const reservation = route.reservationCalls[0]!;
    assert.equal(reservation.accountId, "active-account-test");
    assert.equal(reservation.actorAuthUserId, "actor-test");
    assert.equal(reservation.surface, "studio");
    assert.equal(reservation.mediaKind, kind);
    assert.equal(reservation.quotaAmount, kind === "video" ? 200 + (creationMode === "free" ? 7 : 0) : 7);
    assert.equal(reservation.quotaUnit, "credit");
    assert.equal(route.generationCalls.length, 1);
    assert.equal(route.generationCalls[0]!.request.creationMode, creationMode);
    assert.equal(route.completionCalls.length, 1);
    assert.equal(route.failureCalls.length, 0);
  }
});

test("le rejeu d'une demande Libre retrouve son média sans nouvelle génération ni finalisation", async () => {
  const route = loadRoute();
  assert.equal((await route.post(body())).status, 200);
  const replay = await route.post(body());
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(route.reservationCalls.length, 2, "La réservation existante vérifie l'idempotence.");
  assert.equal(route.generationCalls.length, 1);
  assert.equal(route.completionCalls.length, 1);
  assert.equal(route.failureCalls.length, 0);
});

test("l'empreinte sépare les parcours et couvre la fin d'un long prompt Libre", async () => {
  const prefix = "Un monde imaginaire aux couleurs lumineuses. ".repeat(70);
  const fingerprints: string[] = [];
  for (const overrides of [
    { freePrompt: `${prefix}FIN_ALPHA` },
    { freePrompt: `${prefix}FIN_BETA` },
    { creationMode: "guided", idea: `${prefix}FIN_ALPHA`.slice(0, 2_000), subjectSource: "custom", inputMode: "essential", logoMode: "none", useBrandColors: false },
  ]) {
    const route = loadRoute();
    const response = await route.post(body(overrides));
    assert.equal(response.status, 200);
    fingerprints.push(route.reservationCalls[0]!.requestFingerprint);
  }
  assert.equal(new Set(fingerprints).size, 3);
});

test("l’ADN atteint les deux parcours média et change l’idempotence sans modifier le tarif", async () => {
  for (const kind of ["image", "video"]) {
    const fingerprints: string[] = [];
    const credits: number[] = [];
    for (const option of [{}, { useBusinessDna: false }, { useBusinessDna: true }]) {
      const route = loadRoute();
      const response = await route.post(body({ kind, durationSeconds: kind === "video" ? 8 : undefined, ...option }));
      assert.equal(response.status, 200);
      assert.equal(route.generationCalls[0]!.request.useBusinessDna, "useBusinessDna" in option && option.useBusinessDna === true);
      fingerprints.push(route.reservationCalls[0]!.requestFingerprint);
      credits.push(route.reservationCalls[0]!.quotaAmount);
    }
    assert.equal(fingerprints[0], fingerprints[1], "Une case décochée garde le contrat des créations existantes.");
    assert.notEqual(fingerprints[0], fingerprints[2], "Cocher l’ADN ne doit pas rejouer un résultat préparé sans ADN.");
    assert.equal(new Set(credits).size, 1, "L’option de contexte ne change pas les crédits facturés.");
  }
  const invalid = loadRoute();
  assert.equal((await invalid.post(body({ useBusinessDna: "true" }))).status, 400);
  assert.equal(invalid.reservationCalls.length, 0);
  assert.equal(invalid.generationCalls.length, 0);
});

test("les quotas épuisés et les durées non autorisées bloquent aussi Libre", async () => {
  const exhausted = loadRoute({ quotaReached: true });
  assert.equal((await exhausted.post(body())).status, 429);
  assert.equal(exhausted.generationCalls.length, 0);
  assert.equal(exhausted.completionCalls.length, 0);
  const restricted = loadRoute({ maximumDuration: 8 });
  assert.equal((await restricted.post(body({ kind: "video", durationSeconds: 16 }))).status, 403);
  assert.equal(restricted.reservationCalls.length, 0);
  assert.equal(restricted.generationCalls.length, 0);
});

test("le dialogue Libre atteint le serveur avec son quota vidéo et une empreinte différente de la voix off", async () => {
  const fingerprints: string[] = [];
  for (const teamVideoSpeechMode of ["voiceover", "characters"] as const) {
    const route = loadRoute();
    const response = await route.post(body({ kind: "video", durationSeconds: 16, teamVideoSpeechMode, withNarration: true }));
    assert.equal(response.status, 200);
    const request = route.generationCalls[0]!.request;
    assert.equal(request.teamVideoSpeechMode, teamVideoSpeechMode);
    assert.equal(request.withNarration, teamVideoSpeechMode === "voiceover");
    assert.equal(request.videoEngine, "omni");
    assert.equal(route.reservationCalls[0]!.quotaAmount, 167);
    assert.equal(route.completionCalls.length, 1);
    fingerprints.push(route.reservationCalls[0]!.requestFingerprint);
  }
  assert.equal(new Set(fingerprints).size, 2);
});

test("a recoverable montage failure retains the paid attempt without regeneration or credit release", async () => {
  for (const checkpoint of ["saved", "lost_ack"] as const) {
    const route = loadRoute({ checkpoint, compositionFails: true });
    const response = await route.post(body({ kind: "video", durationSeconds: 8 }));
    assert.equal(response.status, 202);
    assert.equal((await response.json()).code, "AI_MEDIA_FINALIZATION_PENDING");
    assert.equal(route.paidCalls(), 1);
    assert.equal(route.failureCalls.length, 0);
    assert.equal(route.completionCalls.length, 0);
    assert.equal(route.releasedCheckpoints.length, checkpoint === "saved" ? 1 : 0);
  }
});

test("recovery storage and cleanup outages do not invalidate an otherwise successful montage", async () => {
  for (const checkpoint of ["saved", "unavailable"] as const) {
    const route = loadRoute({ checkpoint, cleanupFails: true });
    const response = await route.post(body({ kind: "video", durationSeconds: 8 }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(route.failureCalls.length, 0);
    assert.equal(route.completionCalls.length, 1);
  }
  const failed = loadRoute({ checkpoint: "unavailable", compositionFails: true });
  assert.equal((await failed.post(body({ kind: "video", durationSeconds: 8 }))).status, 502);
  assert.equal(failed.failureCalls.length, 1);
});

test("un échec fournisseur Libre libère une seule réservation et ne débite aucun résultat", async () => {
  const route = loadRoute({ providerFails: true });
  const response = await route.post(body());
  assert.equal(response.status, 502);
  assert.equal(route.reservationCalls.length, 1);
  assert.equal(route.generationCalls.length, 1);
  assert.equal(route.failureCalls.length, 1);
  assert.equal(route.completionCalls.length, 0);
});

test("des voix IA invalides après les secours renvoient une erreur fournisseur et libèrent le quota vidéo", async () => {
  const route = loadRoute({ providerError: new AiJsonResponseNormalizationError("normalizer_failed") });
  const response = await route.post(body({ kind: "video", durationSeconds: 8, teamVideoSpeechMode: "characters" }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "AI_MEDIA_PREPARATION_OUTPUT_INVALID");
  assert.equal(route.reservationCalls[0]!.quotaAmount, 87);
  assert.equal(route.failureCalls.length, 1);
  assert.equal(route.completionCalls.length, 0);
});
