import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createAiMediaRequestFingerprint } from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import { buildInrAgentMediaGenerationRequest } from "../../lib/inrAgentMediaRequest.ts";
import { resolveInrAgentMediaMix } from "../../lib/inrAgentMediaMix.ts";

type Job = { id: string; accountId: string; status: string; fingerprint: string; amount: number; kind: string; mediaId?: string };
type Args = { accountId?: string; generationRequestId?: string; idea?: string; kind?: "image" | "video"; videoDurationSeconds?: 8 };
const source = readFileSync(new URL("../../lib/inrAgentMediaGeneration.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

// In-memory doubles follow the ledger contract: keys are scoped to the account,
// terminal jobs replay unchanged, completion debits once, failure releases only
// a reservation. The real orchestration, request adapter, mix and hash execute.
function harness(options: {
  providerFailures?: number; persistThenThrow?: number; completionFailures?: number;
  acceptanceFailures?: number; registryFailures?: number; gate?: () => Promise<void>;
  reservationOutcome?: "quota_reached" | "premium_required";
} = {}) {
  const jobs = new Map<string, Job>();
  const media = new Map<string, { id: string; accountId: string; media_type: string }>();
  const providerCalls: Array<{ accountId: string; request: ReturnType<typeof buildInrAgentMediaGenerationRequest> }> = [];
  const reservations: Array<{ requestKey: string; quotaAmount: number }> = [];
  const counts = { completions: 0, failures: 0, used: 0 };
  const failures = { ...options };
  const jobById = (id: string, accountId: string) => {
    const job = [...jobs.values()].find((row) => row.id === id && row.accountId === accountId);
    assert.ok(job, "all ledger/registry operations must preserve account scope");
    return job;
  };
  const deps: Record<string, unknown> = {
    "server-only": {}, "node:crypto": crypto,
    "@/lib/aiMediaGenerationQuotaPolicy": { createAiMediaRequestFingerprint },
    "@/lib/inrAgentMediaRequest": { buildInrAgentMediaGenerationRequest },
    "@/lib/inrAgentMediaMix": { resolveInrAgentMediaMix },
    "@/lib/aiMediaQuotaPresentation": { AI_MEDIA_ADMIN_LIMIT_OVERRIDE: 10_000 },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => "premium" },
    "@/lib/aiMediaVideoEntitlementServer": { getAiMediaVideoEntitlement: async () => ({ maxDurationSeconds: 24 }) },
    "@/lib/aiGeneratedMediaRegistry": {
      getPersistedGeneratedAiMediaId: async ({ accountId, jobId }: { accountId: string; jobId: string }) => {
        if ((failures.registryFailures ?? 0) > 0) { failures.registryFailures!--; throw new Error("registry_unavailable"); }
        const job = jobById(jobId, accountId);
        return job.mediaId && media.has(job.mediaId) ? job.mediaId : null;
      },
      acceptGeneratedAiMediaDraft: async ({ accountId, mediaId }: { accountId: string; mediaId: string }) => {
        if ((failures.acceptanceFailures ?? 0) > 0) { failures.acceptanceFailures!--; return null; }
        const item = media.get(mediaId);
        assert.equal(item?.accountId, accountId);
        return item;
      },
    },
    "@/lib/aiMediaGenerationQuota": {
      reserveAiMediaGeneration: async (args: { accountId: string; requestKey: string; requestFingerprint: string; quotaAmount: number; mediaKind: string }) => {
        reservations.push({ ...args });
        assert.ok(args.requestKey.length >= 8 && args.requestKey.length <= 180);
        if (options.reservationOutcome) return { outcome: options.reservationOutcome, jobId: null };
        const key = `${args.accountId}:${args.requestKey}`;
        const existing = jobs.get(key);
        if (existing) {
          if (existing.fingerprint !== args.requestFingerprint || existing.amount !== args.quotaAmount || existing.kind !== args.mediaKind) throw new Error("AI_MEDIA_IDEMPOTENCY_CONFLICT");
          return { outcome: "replayed", jobId: existing.id, status: existing.status };
        }
        const job = { id: `job-${jobs.size + 1}`, accountId: args.accountId, status: "reserved", fingerprint: args.requestFingerprint, amount: args.quotaAmount, kind: args.mediaKind };
        jobs.set(key, job);
        return { outcome: "reserved", jobId: job.id, status: job.status };
      },
      completeAiMediaGeneration: async ({ accountId, jobId, mediaId }: { accountId: string; jobId: string; mediaId: string }) => {
        if ((failures.completionFailures ?? 0) > 0) { failures.completionFailures!--; throw new Error("completion_unavailable"); }
        const job = jobById(jobId, accountId);
        assert.equal(job.mediaId, mediaId);
        if (["failed", "expired"].includes(job.status)) throw new Error("AI_MEDIA_JOB_TERMINAL");
        if (job.status !== "completed") { counts.used += job.amount; counts.completions++; }
        job.status = "completed";
      },
      failAiMediaGeneration: async ({ accountId, jobId }: { accountId: string; jobId: string }) => {
        const job = jobById(jobId, accountId);
        assert.equal(job.mediaId, undefined, "a persisted media must never release its reservation");
        job.status = "failed"; counts.failures++;
      },
    },
    "@/lib/aiMediaGenerationServer": {
      generateAndSaveAiMedia: async (args: { accountId: string; jobId: string; request: ReturnType<typeof buildInrAgentMediaGenerationRequest> }) => {
        providerCalls.push(args);
        if (options.gate) await options.gate();
        if ((failures.providerFailures ?? 0) > 0) { failures.providerFailures!--; throw new Error("provider_failed"); }
        const job = jobById(args.jobId, args.accountId);
        const item = { id: `media-${job.id}`, accountId: args.accountId, media_type: args.request.kind };
        media.set(item.id, item); job.mediaId = item.id;
        if ((failures.persistThenThrow ?? 0) > 0) { failures.persistThenThrow!--; throw new Error("signed_url_unavailable"); }
        return { item, model: "test-no-network", promptVersion: "test" };
      },
    },
  };
  const exports: { generateInrAgentMedia?: (args: Record<string, unknown>) => Promise<{ outcome: string; errorCode?: string; item: { id: string } | null }> } = {};
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(Object.hasOwn(deps, id), `unexpected dependency: ${id}`);
    return deps[id];
  }, exports);
  const run = (args: Args = {}) => exports.generateInrAgentMedia!({
    supabase: {}, accountId: "account-A", actorAuthUserId: "actor-A", adminUnlimited: false,
    idea: "Montrer les étapes de la rénovation d'une cuisine", theme: "realisations", kind: "image",
    generationRequestId: "target-1:signature-1:part-0", variantSeed: "target-1:part-0", ...args,
  });
  return { run, jobs, media, providerCalls, reservations, counts };
}

test("une génération terminée est réutilisée pour la même partie sans second débit", async () => {
  const h = harness();
  const first = await h.run();
  const replay = await h.run();
  assert.equal(first.outcome, "generated"); assert.equal(replay.item?.id, first.item?.id);
  assert.equal(h.providerCalls.length, 1); assert.equal(h.jobs.size, 1); assert.equal(h.counts.used, 1);
});

test("trois parties cohérentes gardent leurs idées distinctes et leurs propres reprises", async () => {
  const h = harness();
  const ideas = ["Cuisine : plan général de la pièce", "Même cuisine : détail du plan de travail", "Même cuisine : vue de la zone repas"];
  const items = [];
  for (let index = 0; index < 3; index++) {
    const args = { generationRequestId: `target-1:signature-1:part-${index}`, idea: ideas[index] };
    const result = await h.run(args); items.push(result.item?.id);
    assert.equal((await h.run(args)).item?.id, result.item?.id);
  }
  assert.equal(new Set(items).size, 3); assert.equal(h.providerCalls.length, 3); assert.equal(h.counts.used, 3);
  assert.deepEqual(h.providerCalls.map((call) => call.request.idea), ideas);
});

test("une reprise concurrente en cours n'appelle pas à nouveau le fournisseur", async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ gate: async () => { started(); await wait; } });
  const first = h.run(); await entered;
  assert.equal((await h.run()).errorCode, "inr_agent_ai_media_generation_in_progress");
  release(); assert.equal((await first).outcome, "generated");
  assert.equal((await h.run()).outcome, "generated");
  assert.equal(h.providerCalls.length, 1); assert.equal(h.counts.used, 1);
});

test("un échec confirmé peut être retenté puis rejoué avec une seule consommation réussie", async () => {
  const h = harness({ providerFailures: 1 });
  assert.equal((await h.run()).outcome, "generation_failed");
  const retry = await h.run(); assert.equal(retry.outcome, "generated");
  assert.equal((await h.run()).item?.id, retry.item?.id);
  assert.equal(h.providerCalls.length, 2); assert.equal(h.jobs.size, 2);
  assert.equal(h.counts.failures, 1); assert.equal(h.counts.used, 1);
});

test("deux reprises du même échec partagent une seule nouvelle réservation", async () => {
  let release!: () => void;
  let started!: () => void;
  let attempt = 0;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ providerFailures: 1, gate: async () => {
    attempt++;
    if (attempt === 2) { started(); await wait; }
  } });
  assert.equal((await h.run()).outcome, "generation_failed");
  const retry = h.run(); await entered;
  assert.equal((await h.run()).errorCode, "inr_agent_ai_media_generation_in_progress");
  release(); assert.equal((await retry).outcome, "generated");
  assert.equal(h.providerCalls.length, 2); assert.equal(h.jobs.size, 2); assert.equal(h.counts.used, 1);
});

test("les échecs persistants sont bornés à trois tentatives, jamais une clé aléatoire à chaque reprise", async () => {
  const h = harness({ providerFailures: 10 });
  for (let i = 0; i < 3; i++) assert.equal((await h.run()).outcome, "generation_failed");
  assert.equal((await h.run()).errorCode, "inr_agent_ai_media_retry_exhausted");
  assert.equal(h.providerCalls.length, 3); assert.equal(h.jobs.size, 3); assert.equal(h.counts.used, 0);
});

test("les erreurs de complétion ou d'acceptation reprennent le même média", async () => {
  for (const options of [{ completionFailures: 1 }, { acceptanceFailures: 1 }, { persistThenThrow: 1 }]) {
    const h = harness(options);
    assert.equal((await h.run()).outcome, "finalization_failed");
    assert.equal((await h.run()).outcome, "generated");
    assert.equal(h.providerCalls.length, 1); assert.equal(h.counts.used, 1);
    assert.equal(h.counts.failures, 0); assert.equal(h.counts.completions, 1);
  }
});

test("une lecture de persistance indisponible ne libère pas le quota et ne relance pas la génération", async () => {
  const h = harness({ providerFailures: 1, registryFailures: 1 });
  assert.equal((await h.run()).errorCode, "inr_agent_ai_media_persistence_check_unavailable");
  assert.equal((await h.run()).errorCode, "inr_agent_ai_media_generation_in_progress");
  assert.equal(h.counts.failures, 0); assert.equal(h.providerCalls.length, 1);
});

test("un résultat supprimé ou un job expiré reste bloqué sans nouvel appel payant", async () => {
  for (const status of ["completed", "expired", "processing"]) {
    const h = harness(); await h.run(); h.media.clear();
    [...h.jobs.values()][0].status = status;
    const replay = await h.run();
    assert.notEqual(replay.outcome, "generated");
    assert.equal(h.providerCalls.length, 1); assert.equal(h.jobs.size, 1);
  }
});

test("la clé ne permet ni de changer l'idée silencieusement ni de récupérer le média d'un autre compte", async () => {
  const h = harness(); const first = await h.run();
  await assert.rejects(h.run({ idea: "Une autre prestation" }), /IDEMPOTENCY_CONFLICT/);
  const other = await h.run({ accountId: "account-B" });
  assert.notEqual(other.item?.id, first.item?.id); assert.equal(h.providerCalls.length, 2);
});

test("le clip court réserve huit secondes et une image une unité", async () => {
  const h = harness();
  await h.run({ kind: "video", videoDurationSeconds: 8 });
  assert.equal(h.providerCalls[0].request.durationSeconds, 8);
  assert.equal(h.providerCalls[0].request.sceneMode, "single");
  assert.equal(h.reservations[0].quotaAmount, 8); assert.equal(h.counts.used, 8);
  const image = harness(); await image.run({ videoDurationSeconds: 8 });
  assert.equal(image.reservations[0].quotaAmount, 1);
  assert.equal(image.providerCalls[0].request.durationSeconds, null);
});

test("quota épuisé ou Studio indisponible ne déclenchent aucun fournisseur", async () => {
  for (const outcome of ["quota_reached", "premium_required"] as const) {
    const h = harness({ reservationOutcome: outcome });
    assert.equal((await h.run()).outcome, outcome === "quota_reached" ? "quota_reached" : "studio_unavailable");
    assert.equal(h.providerCalls.length, 0);
  }
});

test("un appel historique sans identifiant reste une nouvelle génération explicite", async () => {
  const h = harness();
  const first = await h.run({ generationRequestId: undefined });
  const second = await h.run({ generationRequestId: undefined });
  assert.notEqual(first.item?.id, second.item?.id); assert.equal(h.counts.used, 2);
});
