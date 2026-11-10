import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import * as creditPricing from "../../lib/aiMediaCreditsPricing.ts";
import * as characterVoices from "../../lib/aiMediaCharacterVoices.ts";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { createAiMediaRequestFingerprint } from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";
import { AiJsonResponseNormalizationError } from "../../lib/aiJsonResponseNormalization.ts";
import * as generationTransport from "../../lib/aiMediaGenerationTransport.ts";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";
import { assertAiMediaFreeExactNarrationFits } from "../../lib/aiMediaFreeGenerationPrompt.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import type { PreparedAiMediaNarrationVoice } from "../../lib/aiMediaNarrationVoicePreflight.ts";
const clonePolicy = runtimeModules({ "@/lib/aiGatewayAccountGuard": {} })<typeof import("../../lib/aiMediaNarrationVoiceClone.ts")>("lib/aiMediaNarrationVoiceClone.ts");
const narrationLanguage = runtimeModules({ "./aiMediaGenerationContracts.ts": contracts, "@/lib/supabaseAdmin": { supabaseAdmin: { storage: {} } } })<typeof import("../../lib/aiMediaNarrationVoicePreflight.ts")>("lib/aiMediaNarrationVoicePreflight.ts");

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
  if (id === "./aiMediaCharacterVoices.ts") return characterVoices;
  if (id === "./aiMediaModelCatalog.ts") return models;
  throw new Error(`Unisolated quote dependency: ${id}`);
});

type ReservationCall = {
  accountId: string; actorAuthUserId: string; requestKey: string;
  requestFingerprint: string; mediaKind: string; surface: string; quotaAmount: number; quotaUnit: string;
  metadata?: Record<string, unknown>;
};

function loadRoute(options: { authenticated?: boolean; authentication?: Promise<void>; clock?: { now: number }; cancelledKey?: string; cancellationConflictKey?: string; providerFails?: boolean; providerError?: Error; preparationError?: Error; quotaReached?: boolean; maximumDuration?: number; creditsReady?: boolean; preparation?: Promise<void>; work?: Promise<void>; checkpoint?: "saved" | "lost_ack" | "unavailable"; compositionFails?: boolean; cleanupFails?: boolean;
  narrator?: { configured?: boolean; language?: string; profileFails?: boolean; error?: Error; reference?: PreparedAiMediaNarrationVoice } } = {}) {
  const reservationCalls: ReservationCall[] = [];
  const generationCalls: Array<{ request: contracts.AiMediaGenerationRequest; accountId: string; jobId: string; signal?: AbortSignal; deadlineAt?: number; preparedNarrationVoice?: PreparedAiMediaNarrationVoice | null }> = [];
  const narratorPreflights: Array<{ accountId: string; sample: contracts.AiMediaGenerationRequest["narrationVoiceSample"]; consent: boolean; language: string }> = [];
  const narratorEvents: string[] = [];
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
    ["@/lib/aiMediaNarrationVoiceClone", { isAiMediaVoiceCloneConfigured: () => options.narrator?.configured !== false, supportsAiMediaClonedNarrationLanguage: clonePolicy.supportsAiMediaClonedNarrationLanguage }],
    ["@/lib/aiMediaNarrationVoicePreflight", {
      resolveAiMediaNarrationVoiceLanguage: narrationLanguage.resolveAiMediaNarrationVoiceLanguage,
      preflightAiMediaNarrationVoice: async (args: { accountId: string; sample: contracts.AiMediaGenerationRequest["narrationVoiceSample"]; consent: boolean; language: string }) => {
        narratorPreflights.push(args); narratorEvents.push("private-voice");
        assert.equal(args.accountId, "active-account-test"); assert.equal(args.consent, true);
        if (options.narrator?.error) throw options.narrator.error;
        return options.narrator?.reference;
      },
    }],
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
    ["@/lib/aiMediaFreeGenerationPrompt", { AI_MEDIA_FREE_PROMPT_VERSION: "test-free-version", assertAiMediaFreeExactNarrationFits }],
    ["@/lib/aiMediaGenerationQuota", {
      AiMediaGenerationQuotaError: QuotaError,
      createAiMediaRequestFingerprint,
      reserveAiMediaGeneration: async (args: ReservationCall) => {
        narratorEvents.push("reserve");
        reservationCalls.push(args);
        if (options.cancellationConflictKey === args.requestKey) throw Object.assign(new QuotaError("Cette tentative a été fermée avant sa réservation."), { code: "AI_MEDIA_IDEMPOTENCY_CONFLICT", httpStatus: 409 });
        if (options.cancelledKey === args.requestKey) return { outcome: "replayed", status: "failed", jobId: "cancelled-job-a" };
        if (options.quotaReached) return { outcome: "quota_reached", quota: { remaining: 0 } };
        const completed = completedRequests.get(args.requestKey);
        if (completed) {
          if (args.requestFingerprint !== completed.fingerprint) {
            throw Object.assign(new QuotaError("Cette clé de tentative est déjà associée à une autre demande."), {
              code: "AI_MEDIA_IDEMPOTENCY_CONFLICT", httpStatus: 409,
            });
          }
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
      generateAndSaveAiMedia: async (args: { request: contracts.AiMediaGenerationRequest; accountId: string; jobId: string; signal?: AbortSignal; preparedNarrationVoice?: PreparedAiMediaNarrationVoice | null; onBillableWorkStarted?: () => void | Promise<void>; onCompositionReady?: (args: unknown) => Promise<void> }) => {
        generationCalls.push(args);
        await options.preparation;
        args.signal?.throwIfAborted();
        if (options.preparationError) throw options.preparationError;
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
          scope: { activeUserId: "active-account-test", authUserId: "actor-test" }, supabase: { from(table: string) {
            assert.ok(options.narrator, "legacy AI requests must not read clone language");
            assert.ok(["profiles", "business_profiles"].includes(table));
            const query = { select() { return query; }, eq(key: string, value: string) { assert.equal(key, "user_id"); assert.equal(value, "active-account-test"); return query; },
              order() { return query; }, limit() { return query; }, async maybeSingle() { return { data: { ai_language: options.narrator?.language ?? "fr" }, error: options.narrator?.profileFails ? { message: "synthetic unavailable" } : null }; } };
            return query;
          } },
        };
      },
    }],
    ["@/lib/rateLimit", { enforceRateLimit: async () => null }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../app/api/media-generation/generate/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  const routeDate = options.clock ? class extends Date { static now() { return options.clock!.now; } } : Date;
  new Function("module", "exports", "require", "console", "Date", output)(record, record.exports, (specifier: string) => {
    assert.ok(modules.has(specifier), `Dépendance non isolée dans le test de route : ${specifier}`);
    return modules.get(specifier);
  }, { info() {}, warn() {}, error() {} }, routeDate);
  return {
    reservationCalls, generationCalls, completionCalls, failureCalls, lifetimes, releasedCheckpoints, narratorPreflights, narratorEvents,
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

function narratorRequest() {
  const time = Date.now(), date = new Date(time).toISOString().slice(0, 10);
  const path = `_studio-voice-references/${date}/active-account-test__${time}__11111111-1111-4111-8111-111111111111.wav`;
  const reference = { accountId: "active-account-test", path, buffer: Buffer.from("owned reference boundary fixture"), durationSeconds: 6, language: "fr" };
  const request = { kind: "video", videoEngine: "omni", durationSeconds: 8, freePrompt: "Un jardin baigné de lumière.", spokenScript: "Bonjour, découvrez notre jardin.", withNarration: true, teamVideoSpeechMode: "voiceover",
    narrationVoiceMode: "provided", narrationVoiceSample: { path, mimeType: "audio/wav", name: "ma-voix.wav", durationSeconds: 6, sizeBytes: 192_044 }, narrationVoiceConsent: true, narrationVoiceGender: "auto" };
  return { reference, request };
}

test("Booster editorial image context reaches generation intact in JSON and streamed requests", async () => {
  for (const streamed of [false, true]) {
    const route = loadRoute();
    const topic = "Une journée dans notre atelier";
    const response = await route.post(body({ freePrompt: topic, publicationSubject: topic }), streamed ? { headers: { "Content-Type": "application/json", accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE } } : undefined);
    await response.text();
    assert.equal(route.generationCalls.length, 1);
    assert.equal(route.generationCalls[0].request.freePrompt, topic);
    assert.equal(route.generationCalls[0].request.publicationSubject, topic);
  }
});

test("JSON and streamed generation keep the original 760s POST deadline after authentication instead of restarting the work budget", async () => {
  for (const streamed of [false, true]) {
    const clock = { now: 1_800_000_000_000 }, startedAt = clock.now;
    let authenticated!: () => void;
    const authentication = new Promise<void>(resolve => { authenticated = resolve; });
    const route = loadRoute({ clock, authentication });
    const pending = route.post(body(), streamed ? { headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" } } : {});
    assert.equal(route.authenticationCalls(), 1);
    clock.now += 25_000; authenticated();
    const response = await pending; assert.equal(response.status, 200); await response.text();
    await Promise.all(route.lifetimes);
    assert.equal(route.generationCalls.length, 1);
    assert.equal(route.generationCalls[0].deadlineAt, startedAt + 760_000);
    assert.equal(route.generationCalls[0].signal?.aborted, false);
  }
});

test("the real generation route preloads the owned narrator before credits and forwards those exact bytes without a photo", async () => {
  const { reference, request } = narratorRequest(), route = loadRoute({ narrator: { reference } });
  const response = await route.post(body(request)); assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(route.narratorPreflights.length, 1); assert.equal(route.narratorPreflights[0].accountId, "active-account-test");
  assert.equal(route.narratorPreflights[0].language, "fr"); assert.deepEqual(route.narratorEvents.slice(0, 2), ["private-voice", "reserve"]);
  assert.equal(route.generationCalls[0].preparedNarrationVoice, reference);
  assert.equal(route.generationCalls[0].request.spokenScript, request.spokenScript); assert.equal(route.generationCalls[0].request.narrationVoiceSample?.path, reference.path);
  assert.deepEqual(route.generationCalls[0].request.inspirationImages, []); assert.equal(route.generationCalls[0].request.videoEngine, "omni");
});

test("four supplied character voices are refused by the real route before credits or any provider call even on optional photos", async () => {
  const { request } = narratorRequest();
  const inspirationImages = Array.from({ length: 4 }, (_, index) => ({ mimeType: "image/png", data: "a".repeat(96), role: "character", usage: "inspiration",
    characterIndex: index % 3 + 1, voiceMode: "provided", voiceSample: { ...request.narrationVoiceSample, durationSeconds: 4, sizeBytes: 128_044 } }));
  const route = loadRoute(), response = await route.post(body({ ...request, videoEngine: "wan27", withNarration: false, teamVideoSpeechMode: "characters", inspirationImages,
    identityReferenceSetId: "11111111-1111-4111-8111-111111111111", identityConsent: true, teamVideoProviderConsent: true }));
  assert.equal(response.status, 400); assert.match(JSON.stringify(await response.json()), /maximum trois vocaux/);
  assert.equal(route.reservationCalls.length, 0); assert.equal(route.narratorPreflights.length, 0); assert.equal(route.generationCalls.length, 0); assert.equal(route.paidCalls(), 0);
});

test("the real route refuses missing clone readiness unsupported speech or unverifiable language without reserving credits", async () => {
  for (const narrator of [{ configured: false }, { language: "th" }, { profileFails: true }]) {
    const { reference, request } = narratorRequest(), route = loadRoute({ narrator: { reference, ...narrator } });
    const response = await route.post(body({ ...request, spokenScript: undefined, freePrompt: "Un jardin lumineux." }));
    assert.equal(response.status, narrator.configured === false ? 503 : 400);
    assert.equal(route.narratorPreflights.length, 0); assert.equal(route.reservationCalls.length, 0); assert.equal(route.paidCalls(), 0);
  }
});

test("a missing expired or foreign narrator fails before credit reservation and cannot become a generic voice", async () => {
  const { reference, request } = narratorRequest();
  const route = loadRoute({ narrator: { reference, error: new contracts.AiMediaRequestValidationError("Ce vocal est introuvable ou a expiré.") } });
  const response = await route.post(body(request)); assert.equal(response.status, 400);
  assert.equal(route.narratorPreflights.length, 1); assert.equal(route.reservationCalls.length, 0); assert.equal(route.generationCalls.length, 0); assert.equal(route.paidCalls(), 0);
});

test("the real route fingerprints the explicitly chosen narrator and does not pay for a changed voice under the same request ID", async () => {
  const { reference, request } = narratorRequest(), route = loadRoute({ narrator: { reference } });
  assert.equal((await route.post(body(request))).status, 200);
  const response = await route.post(body({ ...request, narrationVoiceSample: { ...request.narrationVoiceSample, path: reference.path.replace("11111111-1111", "22222222-2222") } }));
  assert.equal(response.status, 409); assert.equal(route.generationCalls.length, 1); assert.equal(route.paidCalls(), 1);
});

test("les créations libres passent par la même authentification avant tout débit", async () => {
  const route = loadRoute({ authenticated: false });
  const response = await route.post(body());
  assert.equal(response.status, 401);
  assert.equal(route.reservationCalls.length, 0);
  assert.equal(route.generationCalls.length, 0);
});

test("exact narration exceeding duration is rejected before reservation or AI work, in JSON and streaming", async () => {
  for (const streamed of [false, true]) {
    for (const exact of [{ spokenScript: "Bonjour ".repeat(40) }, { freePrompt: `Un atelier. Voix off : « ${"Bonjour ".repeat(40)} »` }, { spokenScript: "你".repeat(100), freePrompt: "Une scène en chinois." }, { freePrompt: `En chinois. Voix off : « ${"你".repeat(100)} »` }]) {
      const route = loadRoute();
      const raw = await route.post(body({ kind: "video", videoEngine: "grok-lite", durationSeconds: 4, withNarration: true, ...exact }), streamed ? {
        headers: { "Content-Type": "application/json", Accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE },
      } : {});
      const response = await generationTransport.readAiMediaGenerationResponse(raw, () => {});
      assert.equal(response.status, 422);
      assert.equal((response.payload as Record<string, unknown>).code, "AI_MEDIA_EXACT_NARRATION_TOO_LONG");
      assert.equal(route.reservationCalls.length, 0);
      assert.equal(route.generationCalls.length, 0);
      assert.equal(route.paidCalls(), 0);
      assert.equal(route.failureCalls.length, 0);
    }
  }
});

test("speech preflight preserves valid exact copy and explicit silence while refusing impossible character speech", () => {
  for (const overrides of [{ spokenScript: "Bonjour, bienvenue !" }, { spokenScript: "", freePrompt: 'Voix off : « ' + "Bonjour ".repeat(40) + ' »' }, { spokenScript: "Bonjour, bienvenue !", teamVideoSpeechMode: "characters" }]) {
    const input = contracts.normalizeAiMediaGenerationRequest(body({ kind: "video", videoEngine: "grok-lite", durationSeconds: 4, withNarration: true, ...overrides }));
    const before = JSON.stringify(input);
    assert.doesNotThrow(() => assertAiMediaFreeExactNarrationFits(input));
    assert.equal(JSON.stringify(input), before);
  }
  assert.throws(() => contracts.normalizeAiMediaGenerationRequest(body({ kind: "video", videoEngine: "grok-lite", durationSeconds: 4,
    withNarration: false, teamVideoSpeechMode: "characters", spokenScript: "Bonjour ".repeat(40) })), /AI_MEDIA_EXACT_DIALOGUE_TOO_LONG/);
});

test("exact character dialogue is rejected before credits or AI work in both JSON and streaming, including legacy quotations", async () => {
  for (const streamed of [false, true]) for (const speech of [{ spokenScript: "Bonjour ".repeat(40) }, { freePrompt: `Un personnage dit « ${"Bonjour ".repeat(40)} »` }]) {
    const route = loadRoute();
    const raw = await route.post(body({ kind: "video", videoEngine: "veo", durationSeconds: 8, withNarration: false, teamVideoSpeechMode: "characters", ...speech }), streamed ? {
      headers: { "Content-Type": "application/json", Accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE },
    } : {});
    const response = await generationTransport.readAiMediaGenerationResponse(raw, () => {});
    assert.equal(response.status, 422);
    const payload = response.payload as Record<string, unknown>;
    assert.equal(payload.code, "AI_MEDIA_EXACT_DIALOGUE_TOO_LONG");
    assert.match(String(payload.error), /paroles exactes|réplique/i);
    assert.equal(route.reservationCalls.length, 0);
    assert.equal(route.generationCalls.length, 0);
    assert.equal(route.paidCalls(), 0);
  }
});

test("reservation observability uses the active free prompt version and safe separate input lengths", async () => {
  const route = loadRoute();
  const visual = "Un atelier en lumière naturelle.";
  const spokenScript = "Bonjour, bienvenue dans mon atelier.";
  const response = await route.post(body({ kind: "video", videoEngine: "veo", durationSeconds: 8, freePrompt: visual,
    withNarration: false, teamVideoSpeechMode: "characters", spokenScript }));
  assert.equal(response.status, 200);
  const metadata = route.reservationCalls[0].metadata!;
  assert.equal(metadata.prompt_version, "test-free-version");
  assert.equal(metadata.free_prompt_char_count, visual.length);
  assert.equal(metadata.spoken_script_char_count, spokenScript.length);
  assert.ok(!JSON.stringify(metadata).includes(visual));
  assert.ok(!JSON.stringify(metadata).includes(spokenScript));
});

test("an unavailable requested profile logo releases the reservation without paid work or a saved result", async () => {
  const message = "Le logo enregistré dans votre Profil est absent ou illisible. Ajoutez-le à nouveau dans votre Profil, puis relancez la création. Aucun logo de remplacement ne sera inventé.";
  for (const streamed of [false, true]) {
    const route = loadRoute({ preparationError: new contracts.AiMediaRequestValidationError(message) });
    const raw = await route.post(body({ freePrompt: "Ajoute le logo du profil sur cette affiche.", useBusinessDna: true }), streamed ? {
      headers: { "Content-Type": "application/json", Accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE },
    } : {});
    const response = await generationTransport.readAiMediaGenerationResponse(raw, () => {});
    const payload = response.payload as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(payload.error, message);
    assert.equal(payload.item, undefined);
    assert.equal(route.reservationCalls.length, 1);
    assert.equal(route.paidCalls(), 0);
    assert.equal(route.completionCalls.length, 0);
    assert.equal(route.failureCalls.length, 1);
    const release = route.failureCalls[0] as { accountId: string; jobId: string; errorMessage: string };
    assert.equal(release.accountId, "active-account-test");
    assert.equal(release.jobId, route.generationCalls[0].jobId);
    assert.equal(release.errorMessage, message);
  }
});

test("a previously valid HeyGen quote cannot reserve credits or start generation after retirement", async () => {
  const input = body({ kind: "video", format: "landscape", videoEngine: "heygen", videoResolution: "768p", durationSeconds: 5 });
  assert.equal(input.contractVersion, 4);
  const normalized = contracts.normalizeAiMediaGenerationRequest(input);
  // Reproduce the former signer exactly, using historical pricing without the new availability gate.
  const historicalQuote = creditPricing.quoteAiMediaCredits({ ...normalized,
    inspirationImagesCount: normalized.inspirationImages.length,
    hasProvidedCharacterVoice: characterVoices.hasProvidedAiMediaCharacterVoice(normalized.inspirationImages),
  });
  const historicalQuoteId = crypto.createHash("sha256")
    .update(JSON.stringify({ accountId: "active-account-test", ...historicalQuote })).digest("hex");
  const route = loadRoute();
  const response = await route.post({ ...input, expectedCredits: historicalQuote.totalCredits,
    creditTariffVersion: historicalQuote.tariffVersion, creditQuoteId: historicalQuoteId });
  const output = await response.json();
  assert.equal(response.status, 400);
  assert.equal(output.ok, false);
  assert.equal(output.code, "invalid_ai_media_request");
  assert.equal(output.error, "Ces paramètres ne sont pas disponibles pour le moteur choisi. Actualisez le devis ou choisissez une autre durée.");
  assert.equal(output.item, undefined);
  assert.equal(route.reservationCalls.length, 0);
  assert.equal(route.generationCalls.length, 0);
  assert.equal(route.paidCalls(), 0);
  assert.equal(route.completionCalls.length, 0);
  assert.equal(route.failureCalls.length, 0, "no reservation was created to refund");
});

test("generation persists the same safe actionable cause that status recovery will return", async () => {
  for (const [error, code] of [
    [new Error("ai_media_narration_unavailable:La voix off est trop longue pour cette durée."), "AI_MEDIA_NARRATION_TOO_LONG"],
    [new Error("ai_video_omni_rate_limited:Your project has exceeded its monthly spending cap. https://private.invalid/?token=secret"), "AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED"],
    [new Error("Video generation requires a minimum balance of $10. Your current balance is insufficient. Visit https://private.invalid/?token=secret to top up your credits."), "AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT"],
    [new Error("Invalid resolution: 720x1280"), "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED"],
    [new Error("ai_media_generated_narration_invalid"), "AI_MEDIA_GENERATED_NARRATION_INVALID"],
  ] as const) {
    const route = loadRoute({ providerError: error }); const response = await route.post(body()); const payload = await response.json();
    assert.equal(response.status, publicErrors.getAiMediaGenerationPublicError(error).status);
    assert.equal(payload.code, code); assert.equal(payload.error, publicErrors.getAiMediaGenerationPublicError(error).message);
    assert.equal(route.failureCalls.length, 1); assert.equal(route.completionCalls.length, 0); assert.equal(route.generationCalls.length, 1);
    const failure = route.failureCalls[0] as { errorCode: string; errorMessage: string };
    assert.equal(failure.errorCode, payload.code); assert.equal(failure.errorMessage, payload.error);
    assert.doesNotMatch(JSON.stringify(payload), /https:|token|secret|720x1280|monthly spending cap/);
  }
});

for (const status of ["passed", "rejected", "unavailable"] as const) {
  for (const stream of [false, true]) {
    test(`native QA ${status}: real ${stream ? "streaming" : "JSON"} route settles the reservation exactly once and never retries generation`, async () => {
      const error = status === "passed" ? undefined : new Error(status === "rejected"
        ? "ai_media_free_native_character_speech_unusable:spoken_critical_value_mismatch"
        : "ai_media_native_speech_verification_unavailable");
      const route = loadRoute({ providerError: error });
      const input = body({ kind: "video", videoEngine: "grok-lite", videoResolution: "720p", durationSeconds: 15,
        teamVideoSpeechMode: "characters", withNarration: false, spokenScript: "Bonjour, je présente mon atelier.",
        freePrompt: "PRIVATE_PROMPT Une céramiste présente son atelier.",
      });
      const rawResponse = await route.post(input, stream ? {
        headers: { "Content-Type": "application/json", Accept: generationTransport.AI_MEDIA_GENERATION_STREAM_TYPE },
      } : {});
      const response = await generationTransport.readAiMediaGenerationResponse(rawResponse, () => {});
      const payload = response.payload as Record<string, unknown>;
      assert.equal(route.reservationCalls.length, 1);
      assert.ok("expectedCredits" in input);
      assert.equal(route.reservationCalls[0].quotaAmount, input.expectedCredits);
      assert.equal(route.paidCalls(), 1);
      assert.equal(route.generationCalls.length, 1);
      assert.equal(route.releasedCheckpoints.length, 0, "QA failures precede any composition checkpoint");
      if (status === "passed") {
        assert.equal(response.status, 200);
        assert.equal(payload.ok, true);
        assert.equal(route.completionCalls.length, 1, "only verified media settles the debit");
        assert.equal(route.failureCalls.length, 0);
      } else {
        const expectedCode = status === "rejected" ? "AI_MEDIA_VIDEO_SPEECH_MISMATCH" : "AI_MEDIA_VIDEO_SPEECH_VERIFICATION_UNAVAILABLE";
        assert.equal(response.status, status === "rejected" ? 422 : 503);
        assert.equal(payload.code, expectedCode);
        assert.equal(payload.item, undefined);
        assert.equal(route.completionCalls.length, 0);
        assert.equal(route.failureCalls.length, 1, "failed validation releases/refunds the reservation through the existing quota API");
        const release = route.failureCalls[0] as { accountId: string; jobId: string; errorCode: string; errorMessage: string };
        assert.equal(release.accountId, "active-account-test");
        assert.equal(release.jobId, route.generationCalls[0].jobId);
        assert.equal(release.errorCode, expectedCode);
        assert.equal(release.errorMessage, payload.error);
        assert.doesNotMatch(JSON.stringify({ payload, release }), /PRIVATE_PROMPT|Bonjour|céramiste|token|transcript/);
        if (status === "unavailable") {
          assert.equal(payload.error, "La vérification des paroles n’a pas pu aboutir. Réessayez dans quelques instants.");
          assert.doesNotMatch(String(payload.error), /moteur|prompt|correspondent|raccourcissez/);
        }
      }
    });
  }
}

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
  for (const [videoEngine, durationSeconds, expectedCredits] of [["grok-lite", 4, 19], ["grok", 30, 428], ["omni", 20, 207], ["veo", 16, 167], ["wan-flash", 30, 159], ["wan27", 20, 207], ["veo-lite", 16, 55]] as const) {
    const route = loadRoute({ maximumDuration: 30 });
    const response = await route.post(body({ kind: "video", videoEngine, durationSeconds, withNarration: false, teamVideoSpeechMode: "voiceover",
      ...(videoEngine === "wan27" || videoEngine === "wan-flash" ? { identityReferenceSetId: "11111111-1111-4111-8111-111111111111", inspirationImages: [{ mimeType: "image/png", data: "A".repeat(88), role: "product", usage: "inspiration" }] } : {}) }));
    assert.equal(response.status, 200, await response.text());
    assert.equal(route.reservationCalls[0]!.quotaAmount, expectedCredits);
    assert.equal(route.reservationCalls[0]!.quotaUnit, "credit");
    assert.equal(route.generationCalls[0]!.request.videoEngine, videoEngine);
    assert.equal(route.generationCalls[0]!.request.durationSeconds, durationSeconds);
  }
});

test("retired Wan3 and MiniMax H3 reject new requests before reservation or generation in every creation mode", async () => {
  for (const [videoEngine,videoResolution,reason] of [["wan3","1080p",/Wan 3\.0.*autre moteur/],["minimax-h3","768p",/MiniMax H3.*autre moteur/]] as const) for (const creationMode of ["free", "guided"]) {
    const route = loadRoute({ maximumDuration: 30 });
    const input = { contractVersion: 4, requestId: `retired-${videoEngine}-new-request`, source: "studio", operation: "generate", creationMode, kind: "video", videoEngine, durationSeconds: 10, videoResolution, format: "story", freePrompt: "Un jardin paisible.", idea: "Un jardin paisible." };
    const before = JSON.stringify(input), response = await route.post(input);
    assert.equal(response.status, 400); assert.match((await response.json()).error, reason);
    assert.equal(route.reservationCalls.length, 0); assert.equal(route.generationCalls.length, 0); assert.equal(route.paidCalls(), 0); assert.equal(JSON.stringify(input), before);
  }
});

test("les devis Veo distinguent audio natif et silence avant de réserver exactement les crédits autorisés", async () => {
  for (const [videoEngine, silentCredits, nativeCredits] of [["veo", 167, 247], ["veo-lite", 55, 87]] as const) {
    for (const speaking of [false, true]) {
      const route = loadRoute({ maximumDuration: 30 });
      const input = body({ kind: "video", videoEngine, durationSeconds: 16, withNarration: false,
        teamVideoSpeechMode: speaking ? "characters" : "voiceover", spokenScript: speaking ? "Bonjour, bienvenue." : "" });
      const expected = speaking ? nativeCredits : silentCredits;
      assert.ok("expectedCredits" in input, "le serveur a produit un devis valide pour cette variante");
      assert.equal(input.expectedCredits, expected);
      const response = await route.post(input);
      assert.equal(response.status, 200, await response.text());
      assert.equal(route.reservationCalls.length, 1);
      assert.equal(route.reservationCalls[0].quotaAmount, expected);
      assert.equal(route.reservationCalls[0].quotaUnit, "credit");
      assert.equal(route.generationCalls.length, 1);
      assert.equal(route.generationCalls[0].request.spokenScript, speaking ? "Bonjour, bienvenue." : "");
      assert.equal(route.completionCalls.length, 1);
      assert.equal(route.failureCalls.length, 0);
    }
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

test("changing the editorial role of an inherited image subject cannot replay a different image request", async () => {
  const route = loadRoute();
  const topic = "Nos nouveaux services";
  const input = body({ freePrompt: topic, publicationSubject: topic });
  assert.equal((await route.post(input)).status, 200);
  const conflict = await route.post(body({ ...input, publicationSubject: undefined }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "AI_MEDIA_IDEMPOTENCY_CONFLICT");
  assert.equal(route.generationCalls.length, 1);
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

test("exact speech reaches the original generator separately and changing it cannot replay a prior request ID", async () => {
  const route = loadRoute();
  const prefix = "Paroles exactes. ";
  const spokenScript = `${prefix}\n58 € HT/mois : FIN_ALPHA`;
  const input = body({ kind: "video", durationSeconds: 8, videoEngine: "veo", teamVideoSpeechMode: "characters", spokenScript });
  assert.equal((await route.post(input)).status, 200);
  assert.equal(route.generationCalls[0].request.spokenScript, spokenScript);
  const replay = await route.post(input);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  const conflict = await route.post(body({ ...input, spokenScript: `${prefix}\n58 € HT/mois : FIN_BETA` }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "AI_MEDIA_IDEMPOTENCY_CONFLICT");
  assert.equal(route.reservationCalls[0].requestFingerprint, route.reservationCalls[1].requestFingerprint);
  assert.notEqual(route.reservationCalls[0].requestFingerprint, route.reservationCalls[2].requestFingerprint);
  assert.equal(route.generationCalls.length, 1);
  assert.equal(route.paidCalls(), 1);
});

test("an explicitly empty script has a different server identity from absent legacy speech", async () => {
  const route = loadRoute();
  const parameters = { kind: "video", durationSeconds: 8, videoEngine: "veo", teamVideoSpeechMode: "characters",
    freePrompt: 'Une femme dit « Bienvenue ». ' };
  const input = body(parameters);
  assert.equal((await route.post(input)).status, 200);
  assert.equal(route.generationCalls[0].request.spokenScript, undefined);
  const stale = await route.post({ ...input, spokenScript: "" });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "AI_MEDIA_CREDIT_QUOTE_CHANGED");
  assert.equal(route.reservationCalls.length, 1, "le devis audio précédent ne peut pas financer une autre variante");
  const silentInput = body({ ...parameters, spokenScript: "" });
  assert.ok("expectedCredits" in silentInput && "expectedCredits" in input);
  assert.ok(Number(silentInput.expectedCredits) < Number(input.expectedCredits));
  const conflict = await route.post(silentInput);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "AI_MEDIA_IDEMPOTENCY_CONFLICT");
  assert.notEqual(route.reservationCalls[0].requestFingerprint, route.reservationCalls[1].requestFingerprint);
  assert.equal(route.generationCalls.length, 1);
  const empty = loadRoute();
  assert.equal((await empty.post(silentInput)).status, 200);
  assert.equal(empty.generationCalls[0].request.spokenScript, "");
});

test("subtitles default off preserve replay identity while opting in changes the fingerprint without changing the original tariff", async () => {
  const route = loadRoute();
  const input = body({ kind: "video", durationSeconds: 8, videoEngine: "veo", teamVideoSpeechMode: "characters" });
  assert.equal((await route.post(input)).status, 200);
  assert.equal(route.generationCalls[0].request.withSubtitles, false);
  const replay = await route.post({ ...input, withSubtitles: false });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(route.reservationCalls[0].requestFingerprint, route.reservationCalls[1].requestFingerprint);
  const conflict = await route.post({ ...input, withSubtitles: true });
  assert.equal(conflict.status, 409);
  assert.notEqual(route.reservationCalls[0].requestFingerprint, route.reservationCalls[2].requestFingerprint);
  assert.equal(route.reservationCalls[0].quotaAmount, route.reservationCalls[2].quotaAmount);
  assert.equal(route.generationCalls.length, 1);
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
