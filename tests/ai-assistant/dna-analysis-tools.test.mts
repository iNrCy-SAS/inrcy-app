import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { normalizeBusinessWeeklySchedule } from "../../lib/businessWeeklySchedule.ts";
import type * as DnaTools from "../../lib/inrAssistantDnaAnalysisTools.ts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001", JOB = "20000000-0000-4000-8000-000000000001";
const instruction = "Complète mon ADN";
const quota = { remaining: 2, limit: 3, resetAt: "2026-11-01T00:00:00Z" };
const job = (status: string) => ({ id: JOB, status, createdAt: "2026-10-26T10:00:00Z", completedAt: status === "succeeded" ? "2026-10-26T10:02:00Z" : null,
  error: "PRIVATE raw error https://private.invalid/?token=secret", lock_token: "PRIVATE_LOCK", account_id: ACCOUNT,
  result: { analyzedAt: "2026-10-26T10:02:00Z", applied: { changedFields: ["description", "services", "mission", "PRIVATE_unknown_field"], addedItems: 4, completionScore: 72 },
    sources: [{ key: "website", label: "PRIVATE untrusted source label", status: "analyzed", itemCount: 3, url: "https://private.invalid/?token=secret", content: "PRIVATE source content" },
      { key: "facebook", status: "needs_reconnect", itemCount: 0, message: "PRIVATE token" }, { key: "PRIVATE_UNKNOWN", status: "analyzed", itemCount: 100 }] } });
type Options = { actionStartedAt?: string; message?: string; initialJob?: Record<string, unknown> | null; wrongAuth?: boolean; wrongStatusScope?: boolean; wrongDnaScope?: boolean;
  inactive?: boolean; quotaExceeded?: boolean; rateLimited?: boolean; statusUnavailable?: boolean; fieldsUnavailable?: boolean; postUnknown?: boolean; canStartWork?: boolean; timeout?: boolean; weeklySchedule?: unknown };
type Tool = { execute(value: unknown): Promise<DnaTools.InrAssistantDnaAnalysisResult>; inputSchema: { validate?: (value: unknown) => { success: boolean } } };

function harness(options: Options = {}) {
  const calls: Array<{ stage: string; request?: Request }> = [], results: DnaTools.InrAssistantDnaAnalysisResult[] = [];
  let storedJob = options.initialJob ?? null;
  const stubs: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: object) => ({ schema, ...config }) },
    "@/lib/requireUser": { requireUser: async () => { calls.push({ stage: "auth" }); return { activeUserId: options.wrongAuth ? "OTHER_ACCOUNT" : ACCOUNT, authUserId: "ACTOR", supabase: {} }; } },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async (ids: string[]) => {
      calls.push({ stage: "subscription" }); assert.deepEqual(Array.from(ids), [ACCOUNT]); return new Set(options.inactive ? [] : ids);
    } },
    "@/app/api/ai-memory/analyze-channels/route": {
      GET: async () => {
        calls.push({ stage: "status" });
        if (options.timeout) return await new Promise<never>(() => {});
        return Response.json(options.statusUnavailable ? { ok: false, error: "PRIVATE status failure" } : { ok: true, accountId: options.wrongStatusScope ? "OTHER_ACCOUNT" : ACCOUNT, job: storedJob, quota }, { status: options.statusUnavailable ? 503 : 200 });
      },
      POST: async (request: Request) => {
        calls.push({ stage: "start", request });
        if (options.quotaExceeded || options.rateLimited) return Response.json({ ok: false, error_code: options.quotaExceeded ? "business_dna_analysis_quota_reached" : "business_dna_analysis_rate_limit", error: "PRIVATE quota internals" }, { status: 429 });
        storedJob = job("queued");
        if (options.postUnknown) throw new Error("PRIVATE disconnect after actual queue insertion");
        return Response.json({ ok: true, job: storedJob, quota }, { status: 202 });
      },
    },
    "@/app/api/ai-memory/route": { GET: async () => {
      calls.push({ stage: "fields" });
      return Response.json(options.fieldsUnavailable ? { ok: false, error: "PRIVATE memory failure" } : {
        ok: true, accountId: options.wrongDnaScope ? "OTHER_ACCOUNT" : ACCOUNT,
        businessKnowledge: { description: "Entreprise de rénovation locale", services: ["Rénovation", "Peinture"], interventionZones: [], strengths: [], customerTypes: ["particuliers"], weeklySchedule: options.weeklySchedule ?? { days: {} } },
        memory: { mission: "Restaurer votre habitation", values: ["Travail soigné"], referenceDocuments: [{ extractedText: "PRIVATE document body" }], preferredVocabulary: ["api_key=PRIVATE_SECRET", "https://private.invalid/?token=secret"] },
      }, { status: options.fieldsUnavailable ? 503 : 200 });
    } },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantDnaAnalysisTools.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Request, Response, Headers, URL, setTimeout: (callback: () => void, ms: number) => setTimeout(callback, options.timeout ? 5 : ms), clearTimeout, Date })((name: string) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`); return stubs[name];
  }, record, record.exports);
  const runtime = record.exports as typeof DnaTools;
  const create = () => runtime.createInrAssistantDnaAnalysisTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session=synthetic", authorization: "Bearer synthetic", "x-cron-secret": "DO_NOT_FORWARD" } }),
    accountId: ACCOUNT, supabase: { from: () => { throw new Error("No direct SQL or admin reads are expected"); } } as never,
    currentUserMessage: options.message ?? instruction, actionRequestId: `${ACCOUNT}_10000000-0000-4000-8000-000000000002`,
    actionStartedAt: options.actionStartedAt,
    canStartWork: () => options.canStartWork !== false, onResult: value => results.push(value),
  }) as unknown as { startBusinessDnaAnalysis: Tool; getBusinessDnaAnalysis: Tool };
  return { runtime, tools: create(), create, calls, results };
}

test("complete my DNA launches the existing durable channel analysis and returns its real pending identity", async () => {
  const h = harness();
  const result = await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
  assert.equal(result.status, "queued"); assert.equal(result.jobId, JOB); assert.equal(result.persisted, undefined);
  assert.equal(result.missingFields, undefined); assert.equal(result.recordedFacts, undefined);
  assert.equal(result.toolUrl, "/dashboard/adn-entreprise");
  const start = h.calls.find(call => call.stage === "start")!.request!;
  assert.equal(new URL(start.url).pathname, "/api/ai-memory/analyze-channels"); assert.equal(new URL(start.url).search, "?background=1");
  assert.equal(await start.text(), "{}"); assert.equal(start.headers.get("cookie"), "session=synthetic");
  assert.equal(start.headers.get("authorization"), "Bearer synthetic"); assert.equal(start.headers.get("x-cron-secret"), null);
  assert.equal(h.calls.some(call => call.stage === "fields"), false); assert.equal(h.results.length, 1);
  assert.doesNotMatch(result.message, /Je vérifierai/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|account_id|lock_token|private\.invalid/);
});

test("concurrent calls and a fresh request reuse a real pending job instead of consuming another quota", async () => {
  const h = harness();
  const [one, two] = await Promise.all([h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction }), h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction })]);
  assert.equal(one, two); assert.equal(h.calls.filter(call => call.stage === "start").length, 1); assert.equal(h.results.length, 1);
  const repeated = await h.create().startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
  assert.equal(repeated.jobId, JOB); assert.equal(h.calls.filter(call => call.stage === "start").length, 1);
  for (const status of ["queued", "running"]) {
    const pending = harness({ initialJob: job(status), inactive: true });
    assert.equal((await pending.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction })).status, status);
    assert.equal(pending.calls.some(call => call.stage === "subscription" || call.stage === "start"), false);
  }
});

test("a completed analysis reports only recorded complements and truly empty fields without relaunching", async () => {
  const h = harness({ initialJob: job("succeeded") });
  const result = await h.tools.getBusinessDnaAnalysis.execute({});
  assert.equal(result.status, "succeeded"); assert.equal(result.persisted, true); assert.equal(result.fieldsAvailable, true);
  assert.deepEqual(Array.from(result.applied!.fields), ["Description de l’entreprise", "Prestations", "Mission"]);
  assert.ok(result.missingFields?.includes("Zones d’intervention")); assert.ok(result.missingFields?.includes("Horaires"));
  assert.equal(result.missingFields?.includes("Description de l’entreprise"), false);
  assert.ok(result.recordedFacts?.some(fact => fact.value === "Entreprise de rénovation locale"));
  assert.equal(result.sources?.[0].label, "Site Web"); assert.equal(result.sources?.[1].status, "needs_reconnect");
  assert.equal(h.calls.some(call => call.stage === "start" || call.stage === "subscription"), false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|token|private\.invalid|referenceDocuments|account_id/);
  assert.ok(JSON.stringify(result).length < 6_000);
});

test("failed analysis and unavailable field reads stay honest and never invent missing facts", async () => {
  const failed = harness({ initialJob: job("failed") });
  const result = await failed.tools.getBusinessDnaAnalysis.execute({});
  assert.equal(result.status, "failed"); assert.equal(result.persisted, undefined); assert.equal(result.missingFields, undefined);
  assert.equal(failed.calls.some(call => call.stage === "fields" || call.stage === "start"), false);
  for (const options of [{ fieldsUnavailable: true }, { wrongDnaScope: true }]) {
    const h = harness({ ...options, initialJob: job("succeeded") });
    const value = await h.tools.getBusinessDnaAnalysis.execute({});
    assert.equal(value.status, "succeeded"); assert.equal(value.fieldsAvailable, false);
    assert.equal(value.recordedFacts, undefined); assert.equal(value.missingFields, undefined);
    assert.match(value.message, /n’ont pas pu être vérifiées/);
  }
});

test("the native normalized weeklySchedule.days structure counts recorded opening hours", async () => {
  const weeklySchedule = normalizeBusinessWeeklySchedule({ days: { monday: { open: true, allDay: false, slots: [{ start: "09:00", end: "17:00" }] } } });
  assert.equal(weeklySchedule.days.monday.open, true);
  const h = harness({ initialJob: job("succeeded"), weeklySchedule });
  const result = await h.tools.getBusinessDnaAnalysis.execute({});
  assert.equal(result.missingFields?.includes("Horaires"), false);
});

test("advice, stale or quoted intent, negation and a broken analysis button cannot start paid work", async () => {
  for (const message of ["Comment compléter mon ADN ?", "Peux-tu m’expliquer comment analyser mon ADN ?", "Le bouton Compléter mon ADN ne fonctionne pas", "Hier tu voulais compléter mon ADN", "Voici une citation : « Complète mon ADN »", "Ne complète pas mon ADN", "N’analyse pas mon ADN", "Oui", "Mon ADN est incomplet"]) {
    const h = harness({ message });
    const result = await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: message });
    assert.equal(result.status, "needs_instruction", message); assert.equal(h.calls.length, 0, message);
  }
  const h = harness({ message: "Complète mon ADN" });
  assert.equal((await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: "Analyse mon ADN" })).status, "needs_instruction");
});

test("clear current analysis and completion instructions remain actionable", async () => {
  for (const message of ["Complète mon ADN", "Peux-tu remplir mon ADN à partir de mes canaux ?", "Analyse mes canaux pour compléter mon ADN", "Lance l’analyse de mon ADN", "Complete my business DNA"]) {
    const h = harness({ message });
    assert.equal((await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: message })).status, "queued", message);
  }
});

test("foreign authentication, unavailable status, missing subscription or expired workflow stop before dispatch", async () => {
  for (const options of [{ wrongAuth: true }, { wrongStatusScope: true }, { statusUnavailable: true }, { inactive: true }, { canStartWork: false }, { timeout: true }]) {
    const h = harness(options);
    const result = await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
    assert.ok(["blocked", "unavailable"].includes(result.status)); assert.equal(h.calls.some(call => call.stage === "start"), false);
    assert.doesNotMatch(JSON.stringify(result), /OTHER_ACCOUNT|PRIVATE/);
  }
});

test("native quota and cooldown remain authoritative and are never retried by a fallback", async () => {
  for (const options of [{ quotaExceeded: true }, { rateLimited: true }]) {
    const h = harness(options);
    assert.equal((await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction })).status, "blocked");
    await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
    assert.equal(h.calls.filter(call => call.stage === "start").length, 1); assert.doesNotMatch(JSON.stringify(h.results), /PRIVATE/);
  }
});

test("an uncertain accepted dispatch is checked through its pending job instead of started twice", async () => {
  const h = harness({ postUnknown: true });
  const result = await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
  assert.equal(result.status, "unknown"); assert.equal(result.persisted, undefined);
  await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
  assert.equal(h.calls.filter(call => call.stage === "start").length, 1);
  assert.equal((await h.create().getBusinessDnaAnalysis.execute({})).status, "queued");
});

test("a resumed durable turn reuses even a completed or failed job accepted after its original timestamp", async () => {
  for (const status of ["succeeded", "failed"]) {
    for (const actionStartedAt of ["2026-10-26T09:59:59Z", "2026-10-26T10:00:00Z"]) {
      const h = harness({ initialJob: job(status), actionStartedAt, inactive: true });
      const first = await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
      const retry = await h.create().startBusinessDnaAnalysis.execute({ instructionQuote: instruction });
      assert.equal(first.status, status); assert.equal(retry.status, status);
      assert.equal(first.jobId, JOB); assert.equal(retry.jobId, JOB);
      assert.equal(h.calls.some(call => call.stage === "start" || call.stage === "subscription"), false);
    }
  }
});

test("a new turn may start after an older completed job but cannot bypass an invalid trusted timestamp", async () => {
  const newer = harness({ initialJob: job("succeeded"), actionStartedAt: "2026-10-26T10:30:00Z" });
  assert.equal((await newer.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction })).status, "queued");
  assert.equal(newer.calls.filter(call => call.stage === "start").length, 1);
  for (const actionStartedAt of ["", "invalid-date", "not-a-server-timestamp"]) {
    const h = harness({ actionStartedAt });
    assert.equal((await h.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction })).status, "blocked");
    assert.equal(h.calls.length, 0);
  }
  const unknown = harness({ actionStartedAt: "2026-10-26T09:00:00Z", initialJob: { ...job("succeeded"), createdAt: "invalid" } });
  assert.equal((await unknown.tools.startBusinessDnaAnalysis.execute({ instructionQuote: instruction })).status, "unknown");
  assert.equal(unknown.calls.some(call => call.stage === "start"), false);
});

test("runtime schemas refuse arbitrary account, URL, engine, force and quota fields", async () => {
  const h = harness();
  for (const invalid of [{ instructionQuote: instruction, accountId: "OTHER_ACCOUNT" }, { instructionQuote: instruction, actionStartedAt: "2026-01-01T00:00:00Z" }, { instructionQuote: instruction, force: true }, { instructionQuote: instruction, engine: "expensive" }, { instructionQuote: instruction, url: "https://foreign.invalid" }, { instructionQuote: "x".repeat(1201) }]) {
    assert.equal(h.tools.startBusinessDnaAnalysis.inputSchema.validate?.(invalid).success, false);
    await assert.rejects(h.tools.startBusinessDnaAnalysis.execute(invalid));
  }
  await assert.rejects(h.tools.getBusinessDnaAnalysis.execute({ accountId: "OTHER_ACCOUNT" }));
  assert.equal(h.calls.length, 0);
});
