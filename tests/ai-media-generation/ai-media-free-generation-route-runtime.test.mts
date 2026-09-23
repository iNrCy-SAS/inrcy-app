import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import { createAiMediaRequestFingerprint } from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import * as sensitiveText from "../../lib/aiMediaSensitiveText.ts";

type ReservationCall = {
  accountId: string; actorAuthUserId: string; requestKey: string;
  requestFingerprint: string; mediaKind: string; surface: string; quotaAmount: number;
};

function loadRoute(options: { authenticated?: boolean; providerFails?: boolean; quotaReached?: boolean; maximumDuration?: number } = {}) {
  const reservationCalls: ReservationCall[] = [];
  const generationCalls: Array<{ request: contracts.AiMediaGenerationRequest; accountId: string; jobId: string }> = [];
  const completionCalls: unknown[] = [];
  const failureCalls: unknown[] = [];
  const completedRequests = new Map<string, { fingerprint: string; jobId: string }>();
  const pendingRequests = new Map<string, { fingerprint: string; jobId: string }>();
  const item = {
    id: "generated-media-test-id", media_type: "image", signed_url: "https://example.invalid/result.jpg",
  };
  const quota = { image: { remaining: 19 }, video: { remaining: 24 } };
  class AccountLimitError extends Error {}
  class GuardUnavailableError extends Error {}
  class QuotaError extends Error {}
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/aiGatewayAccountGuard", { AiGatewayAccountLimitError: AccountLimitError, AiGatewayGuardUnavailableError: GuardUnavailableError }],
    ["@/lib/aiMediaGenerationContracts", contracts],
    ["@/lib/aiMediaGenerationPrompt", { AI_MEDIA_PROMPT_VERSION: "test-version" }],
    ["@/lib/aiMediaFreeGenerationPrompt", { AI_MEDIA_FREE_PROMPT_VERSION: "test-free-version" }],
    ["@/lib/aiMediaGenerationQuota", {
      AiMediaGenerationQuotaError: QuotaError,
      createAiMediaRequestFingerprint,
      reserveAiMediaGeneration: async (args: ReservationCall) => {
        reservationCalls.push(args);
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
      generateAndSaveAiMedia: async (args: { request: contracts.AiMediaGenerationRequest; accountId: string; jobId: string }) => {
        generationCalls.push(args);
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
    ["@/lib/aiMediaVideoEntitlementServer", { getAiMediaVideoEntitlement: async () => ({ maxDurationSeconds: options.maximumDuration ?? 24 }) }],
    ["@/lib/multicompte/server", {
      getCurrentInrcyAccountScope: async () => options.authenticated === false ? null : {
        scope: { activeUserId: "active-account-test", authUserId: "actor-test" }, supabase: {},
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
    reservationCalls, generationCalls, completionCalls, failureCalls,
    post: (body: unknown) => record.exports.POST(new Request("https://example.invalid/api/media-generation/generate", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })),
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 4, requestId: "free-route-runtime-0001", source: "studio", operation: "generate",
    creationMode: "free", kind: "image", format: "square",
    freePrompt: "Une affiche violette avec le texte exact : 21 jours gratuits.",
    ...overrides,
  };
}

test("les créations libres passent par la même authentification avant tout débit", async () => {
  const route = loadRoute({ authenticated: false });
  const response = await route.post(body());
  assert.equal(response.status, 401);
  assert.equal(route.reservationCalls.length, 0);
  assert.equal(route.generationCalls.length, 0);
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

test("Libre et Guidé partagent le quota d'établissement : une image ou les secondes vidéo", async () => {
  for (const creationMode of ["free", "guided"]) for (const kind of ["image", "video"]) {
    const route = loadRoute();
    const response = await route.post(body({
      creationMode, kind, durationSeconds: kind === "video" ? 24 : undefined,
      subjectSource: "custom", idea: "Un paysage coloré et original.", inputMode: "essential",
    }));
    assert.equal(response.status, 200, `${creationMode}/${kind}: ${await response.text()}`);
    assert.equal(route.reservationCalls.length, 1);
    const reservation = route.reservationCalls[0]!;
    assert.equal(reservation.accountId, "active-account-test");
    assert.equal(reservation.actorAuthUserId, "actor-test");
    assert.equal(reservation.surface, "studio");
    assert.equal(reservation.mediaKind, kind);
    assert.equal(reservation.quotaAmount, kind === "video" ? 24 : 1);
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

test("les quotas épuisés et les durées non autorisées bloquent aussi Libre", async () => {
  const exhausted = loadRoute({ quotaReached: true });
  assert.equal((await exhausted.post(body())).status, 429);
  assert.equal(exhausted.generationCalls.length, 0);
  assert.equal(exhausted.completionCalls.length, 0);
  const restricted = loadRoute({ maximumDuration: 8 });
  assert.equal((await restricted.post(body({ kind: "video", durationSeconds: 24 }))).status, 403);
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
    assert.equal(route.reservationCalls[0]!.quotaAmount, 16);
    assert.equal(route.completionCalls.length, 1);
    fingerprints.push(route.reservationCalls[0]!.requestFingerprint);
  }
  assert.equal(new Set(fingerprints).size, 2);
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
