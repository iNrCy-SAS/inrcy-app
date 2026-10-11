import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

import * as memoryLib from "../../lib/aiMemory.ts";
import * as sourceBudget from "../../lib/businessDnaSourceBudget.ts";
import * as timing from "../../lib/businessDnaAnalysisTiming.ts";
import * as documentBudget from "../../lib/businessDnaDocumentBudget.ts";
import { createAiOperationBudget } from "../../lib/aiGatewayPolicy.ts";
import * as safe from "../../lib/tsSafe.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const ACCOUNT = "00000000-0000-4000-8000-000000000011";
const OTHER = "00000000-0000-4000-8000-000000000012";
const ACTOR = "00000000-0000-4000-8000-000000000021";
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

function load<T>(file: string, deps: Record<string, unknown>): T {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", code)(loaded, loaded.exports, (name: string) => {
    if (name === "server-only") return {};
    if (Object.hasOwn(deps, name)) return deps[name];
    throw new Error(`Unexpected dependency ${name}`);
  });
  return loaded.exports as T;
}

async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.inrcy_accounts(id uuid primary key);
    create table public.inrcy_account_members(account_id uuid, auth_user_id uuid);
    insert into public.inrcy_accounts values ('${ACCOUNT}'), ('${OTHER}');
    insert into public.inrcy_account_members values ('${ACCOUNT}', '${ACTOR}');
    create table public.business_dna_analysis_plan_limits(edition text primary key, monthly_limit integer);
    insert into public.business_dna_analysis_plan_limits values ('standard',3),('admin',16);
    create table public.business_dna_analysis_monthly_usage(
      account_id uuid, period_start date, used_count integer, primary key(account_id,period_start));
    create function public.inrcy_touch_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at := now(); return new; end; $$;
    grant all on all tables in schema public to service_role;
  `);
  const legacy = read("ops/sql/2026-09-04_ai_memory_and_channel_lengths.sql");
  for (const name of ["business_dna_assert_account_actor", "get_business_dna_analysis_quota"]) {
    const definition = legacy.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];
    assert.ok(definition, name);
    await db.exec(definition);
  }
  await db.exec(read("ops/sql/2026-09-05_business_dna_quota_period_start_ambiguity.sql"));
  await db.exec(read("supabase/migrations/20261011212426_business_dna_manual_background_analysis.sql"));
  return db;
}

async function start(db: PGlite) {
  return (await db.query<{ outcome: string; job: Record<string, unknown> }>(
    "select * from public.start_business_dna_manual_analysis_job($1,$2,'standard')", [ACCOUNT, ACTOR],
  )).rows[0];
}
async function usage(db: PGlite) {
  return (await db.query<{ used: number }>("select coalesce(sum(used_count),0)::int as used from public.business_dna_analysis_monthly_usage where account_id=$1", [ACCOUNT])).rows[0].used;
}

test("deux lancements et deux exécuteurs réutilisent une seule tâche et un seul quota ; les autres comptes sont interdits", async () => {
  const db = await createDb();
  try {
    const [first, second] = await Promise.all([start(db), start(db)]);
    assert.deepEqual([first.outcome, second.outcome], ["created", "existing"]);
    assert.equal(first.job.id, second.job.id);
    assert.equal(await usage(db), 1);
    await assert.rejects(db.query("select * from public.start_business_dna_manual_analysis_job($1,$2,'standard')", [OTHER, ACTOR]), /BUSINESS_DNA_ACCOUNT_ACCESS_DENIED/);
    const claims = await Promise.all([0, 1].map(() => db.query<{ job: Record<string, unknown> | null }>(
      "select public.claim_business_dna_manual_analysis_job($1) as job", [first.job.id],
    )));
    assert.equal(claims.filter((item) => item.rows[0].job).length, 1);
    const permissions = await db.query<{ can_read: boolean; can_execute: boolean; service_can_delete: boolean }>(`
      select has_table_privilege('authenticated','public.business_dna_manual_analysis_jobs','SELECT') as can_read,
      has_function_privilege('authenticated','public.start_business_dna_manual_analysis_job(uuid,uuid,text)','EXECUTE') as can_execute,
      has_table_privilege('service_role','public.business_dna_manual_analysis_jobs','DELETE') as service_can_delete
    `);
    assert.deepEqual(permissions.rows[0], { can_read: false, can_execute: false, service_can_delete: false });
  } finally { await db.close(); }
});

test("un échec restitue une seule fois le quota du mois réservé, sans toucher au mois suivant", async () => {
  const db = await createDb();
  try {
    const task = await start(db);
    await db.exec(`
      update public.business_dna_manual_analysis_jobs set quota_period_start = date '2026-09-01';
      insert into public.business_dna_analysis_monthly_usage values ('${ACCOUNT}','2026-09-01',1)
        on conflict (account_id,period_start) do update set used_count=1;
      insert into public.business_dna_analysis_monthly_usage values ('${ACCOUNT}','2026-11-01',2)
        on conflict (account_id,period_start) do update set used_count=2;
    `);
    for (let i = 0; i < 2; i++) {
      await db.query("select public.complete_business_dna_manual_analysis_job($1,null,'failed','{}','Lecture indisponible')", [task.job.id]);
    }
    const counts = await db.query<{ period: string; used_count: number }>(
      "select period_start::text as period, used_count from public.business_dna_analysis_monthly_usage where period_start in ('2026-09-01','2026-11-01') order by period_start",
    );
    assert.deepEqual(counts.rows, [{ period: "2026-09-01", used_count: 0 }, { period: "2026-11-01", used_count: 2 }]);
  } finally { await db.close(); }
});

test("une tâche serveur expirée est remboursée et ne relance pas l'IA automatiquement", async () => {
  const db = await createDb();
  try {
    const task = await start(db);
    await db.query("select public.claim_business_dna_manual_analysis_job($1)", [task.job.id]);
    await db.exec("update public.business_dna_manual_analysis_jobs set expires_at=now()-interval '1 second'");
    assert.equal((await db.query<{ count: number }>("select public.expire_business_dna_manual_analysis_jobs() as count")).rows[0].count, 1);
    assert.equal(await usage(db), 0);
    assert.equal((await db.query<{ job: unknown }>("select public.claim_business_dna_manual_analysis_job($1) as job", [task.job.id])).rows[0].job, null);
  } finally { await db.close(); }
});

type HarnessOptions = {
  noSources?: boolean; providerFailure?: boolean; completionFailure?: boolean;
  channelCollectionFailure?: boolean; documentCollectionFailure?: boolean;
  readableDocument?: boolean; cacheFailure?: boolean;
};
async function harness(options: HarnessOptions = {}) {
  const db = await createDb();
  let memory = memoryLib.normalizeAiMemory({ referenceDocuments: [{
    id: "private-doc", name: "scan.pdf", bucket: "inrcy-ai-documents",
    path: `users/${ACCOUNT}/ai-memory-documents/scan.pdf`, status: options.readableDocument ? "analysed" : "error",
    extractedText: options.readableDocument ? "Entreprise de rénovation. Préparation des surfaces. Travaux de qualité." : "", size: 1024,
  }] });
  let business: Record<string, unknown> = { company_name: "Entreprise test", ai_preferred_engine: "anthropic", services: ["Service initial"] };
  const afterCallbacks: Array<() => Promise<void>> = [];
  let release!: () => void;
  const providerGate = new Promise<void>((resolve) => { release = resolve; });
  let providerCalls = 0;
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    const placeholders = keys.map((key, i) => `${key} => $${i + 1}${key === "p_result" ? "::jsonb" : ""}`).join(",");
    const values = keys.map((key) => key === "p_result" ? JSON.stringify(args[key]) : args[key]);
    try {
      const isTable = name === "start_business_dna_manual_analysis_job";
      const result = await db.query(isTable ? `select * from public.${name}(${placeholders})`
        : `select public.${name}(${placeholders}) as result`, values);
      return { data: isTable ? result.rows : (result.rows[0] as Record<string, unknown>).result, error: null };
    } catch (error) { return { data: null, error }; }
  };
  const sdk = { rpc, from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      order: () => query, limit: () => query,
      maybeSingle: async () => {
        if (table === "business_dna_manual_analysis_jobs") {
          const result = await db.query("select * from public.business_dna_manual_analysis_jobs where account_id=$1" + (filters.id ? " and id=$2" : ""),
            filters.id ? [filters.account_id, filters.id] : [filters.account_id]);
          return { data: result.rows[0] || null, error: null };
        }
        const data = table === "business_ai_memories" ? { memory: structuredClone(memory) }
          : table === "business_profiles" ? structuredClone(business)
            : table === "profiles" ? { company_legal_name: "Entreprise test" } : { settings: {} };
        return { data, error: null };
      },
      upsert: async (value: Record<string, unknown>) => {
        if (table === "business_ai_memories") memory = memoryLib.normalizeAiMemory(value.memory);
        else if (table === "business_profiles") business = { ...business, ...value };
        else throw new Error("Unexpected write " + table);
        return { error: null };
      },
    };
    return query;
  } };
  class QuotaError extends Error {}
  const quotaModule = { BusinessDnaAnalysisQuotaError: QuotaError,
    getBusinessDnaAnalysisQuota: async () => ({ limit: 3, used: await usage(db), remaining: 3 - await usage(db), resetAt: "2030-01-01T00:00:00Z" }),
    consumeBusinessDnaAnalysisQuota: () => { throw new Error("Background quota must not be consumed twice"); },
    refundBusinessDnaAnalysisQuota: () => { throw new Error("Background refund must be atomic with its job"); } };
  const jobs = load<typeof import("../../lib/businessDnaManualAnalysisJobs.ts")>("lib/businessDnaManualAnalysisJobs.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: sdk }, "@/lib/tsSafe": safe, "@/lib/businessDnaAnalysisQuota": quotaModule,
  });
  const documentSources = load<typeof import("../../lib/businessDnaReferenceDocumentSource.ts")>("lib/businessDnaReferenceDocumentSource.ts", {
    "./businessDnaDocumentBudget.ts": documentBudget,
  });
  const sources = options.noSources ? [] : [{ key: "website", label: "Site web", status: "analyzed", itemCount: 1,
    recentItemCount: 0, contentChars: 150, content: "Entreprise de rénovation. Travaux de qualité. Service nouveau.", url: null, message: null }];
  const route = load<{ POST: (request: Request) => Promise<Response>; GET: () => Promise<Response> }>("app/api/ai-memory/analyze-channels/route.ts", {
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) },
      after: (callback: () => Promise<void>) => { afterCallbacks.push(callback); } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (_error: unknown, config: { fallback: string; status: number }) => Response.json({ user_message: config.fallback }, { status: config.status }) },
    "@/lib/aiGatewayClient": { aiGenerateJSON: async (args: Record<string, unknown>) => {
      assert.equal(args.engine, "anthropic"); providerCalls++; providerStarted(); await providerGate;
      if (options.providerFailure || (options.completionFailure && providerCalls > 1)) throw new Error("Provider unavailable");
      return { businessKnowledge: { services: ["Service nouveau"] }, memory: { values: ["Qualité"] } };
    } },
    "@/lib/aiGatewayPolicy": { createAiOperationBudget },
    "@/lib/aiEnginePreference": { normalizeAiPreferredEngine: (value: unknown) => value },
    "@/lib/businessDnaAnalysisDepth": { getBusinessDnaAnalysisDepthGaps: () => options.completionFailure ? ["values"] : [], mergeBusinessDnaAnalysisDrafts: (value: unknown) => value },
    "@/lib/aiMemory": memoryLib,
    "@/lib/businessDnaChannelAnalysis": { collectBusinessDnaChannelSources: async () => {
      if (options.channelCollectionFailure) throw new Error("Channels unavailable");
      return sources;
    },
      getPublicBusinessDnaSourceResults: (items: Array<Record<string, unknown>>) => items.map(({ content, ...publicItem }) => {
        void content; return publicItem;
      }) },
    "@/lib/businessDnaReferenceDocumentSource": documentSources,
    "@/lib/businessDnaReferenceDocumentRefresh": { refreshBusinessDnaReferenceDocuments: async (value: unknown) => {
      if (options.documentCollectionFailure) throw new Error("Storage unavailable");
      return value;
    } },
    "@/lib/businessDnaManualAnalysisJobs": jobs,
    "@/lib/businessDnaAnalysisTiming": timing,
    "@/lib/businessDnaChannelAvailability": { buildBusinessDnaDashboardChannelAvailability: () => [] },
    "@/lib/businessDnaSourceBudget": sourceBudget,
    "@/lib/businessDnaAnalysisQuota": quotaModule,
    "@/lib/aiUsageQuota": { isAdminUserForAi: async () => false },
    "@/lib/boosterGenerationContext": { invalidateBoosterGenerationContext: async () => {
      if (options.cacheFailure) throw new Error("Cache unavailable");
    } },
    "@/lib/cronAuth": { isAuthorizedCronRequest: () => false, getCronUserIdFromRequest: () => "" },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => "standard" },
    "@/lib/channelConnectionState": { getChannelConnectionStates: async () => ({}) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/requireUser": { requireUser: async () => ({ supabase: sdk, activeUserId: ACCOUNT, authUserId: ACTOR, errorResponse: null }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: sdk }, "@/lib/tsSafe": safe,
    "@/lib/businessDnaActivityAutofill": { buildBusinessDnaProfessionCatalog: () => "", buildMissingBusinessDnaProfession: () => "", resolveBusinessDnaProfessionSuggestion: () => null },
    "@/lib/professionalBusinessIdentity": { INTERNAL_PRODUCT_COMPANY_NAMES: [], resolveProfessionalCompanyNameFromProfile: () => "Entreprise test",
      sanitizeProfessionalIdentityText: (value: unknown) => value, sanitizeProfessionalIdentityValue: (value: unknown) => value },
    "@/lib/businessWeeklySchedule": { decodeBusinessWeeklySchedule: () => undefined, encodeBusinessWeeklySchedule: () => "", formatBusinessWeeklySchedule: () => "" },
    "@/lib/businessDnaRecentNews": { buildBusinessDnaRecentWindow: () => ({ start: "2026-10-01", end: "2026-10-11" }), buildBusinessDnaAnalysisHistoryWindow: () => ({}) },
  });
  return { db, route, afterCallbacks, release, started, providerCalls: () => providerCalls, memory: () => memory,
    business: () => business, editBusiness: () => { business.services = ["Service initial", "Modification manuelle récente"]; } };
}

test("le navigateur reçoit 202 avant l'IA ; le serveur finit et enregistre après son départ, malgré un PDF illisible", async () => {
  const h = await harness();
  try {
    const request = () => new Request("https://app.example/api/ai-memory/analyze-channels?background=1", { method: "POST" });
    assert.equal((await h.route.POST(new Request("https://app.example/api/ai-memory/analyze-channels?manual_job=00000000-0000-4000-8000-000000000031", { method: "POST" }))).status, 401);
    const response = await h.route.POST(request());
    assert.equal(response.status, 202);
    const accepted = await response.json();
    assert.equal(accepted.job.status, "queued");
    assert.equal(h.providerCalls(), 0);
    assert.equal((await h.route.POST(request())).status, 202);
    assert.equal(h.afterCallbacks.length, 1);
    const background = h.afterCallbacks[0]();
    await h.started;
    h.editBusiness();
    // Aucune sauvegarde ni réponse de la page n'est attendue à partir d'ici.
    h.release(); await background;
    const status = await (await h.route.GET()).json();
    assert.equal(status.job.status, "succeeded");
    assert.equal(status.quota.used, 1);
    assert.equal(h.providerCalls(), 1);
    assert.ok(h.memory().values.includes("Qualité"));
    assert.equal(h.memory().referenceDocuments[0].id, "private-doc");
    assert.ok((h.business().services as string[]).includes("Modification manuelle récente"));
    assert.ok((h.business().services as string[]).includes("Service nouveau"));
    assert.equal(status.job.result.sources.find((source: { key: string }) => source.key === "reference_documents").status, "failed");
    assert.equal(status.job.lock_token, undefined);
    assert.equal(status.job.actor_auth_user_id, undefined);
  } finally { await h.db.close(); }
});

test("si aucune source n'est lisible, le résultat explique l'absence de sources et restitue le quota sans appel IA", async () => {
  const h = await harness({ noSources: true });
  try {
    await h.route.POST(new Request("https://app.example/api/ai-memory/analyze-channels?background=1", { method: "POST" }));
    await h.afterCallbacks[0]();
    const status = await (await h.route.GET()).json();
    assert.equal(status.job.status, "failed");
    assert.match(status.job.error, /Connectez un site ou un canal/);
    assert.equal(status.quota.used, 0);
    assert.equal(h.providerCalls(), 0);
  } finally { await h.db.close(); }
});

const failureScenarios: Array<[string, HarnessOptions]> = [
  ["une panne des canaux laisse les documents lisibles alimenter l'ADN", { channelCollectionFailure: true, readableDocument: true }],
  ["une panne de Storage conserve les anciens extraits et les autres canaux", { documentCollectionFailure: true, readableDocument: true }],
  ["une erreur sur le complément ou le cache conserve et valide le premier résultat", { completionFailure: true, cacheFailure: true }],
];
for (const [label, options] of failureScenarios) {
  test(label, async () => {
    const h = await harness(options);
    try {
      const response = await h.route.POST(new Request("https://app.example/api/ai-memory/analyze-channels?background=1", { method: "POST" }));
      assert.equal(response.status, 202);
      h.release(); await h.afterCallbacks[0]();
      const status = await (await h.route.GET()).json();
      assert.equal(status.job.status, "succeeded");
      assert.ok(h.memory().values.includes("Qualité"));
      assert.equal(status.quota.used, 1);
      if (options.channelCollectionFailure) {
        assert.equal(status.job.result.sources.find((source: { key: string }) => source.key === "channels").status, "failed");
      }
    } finally { await h.db.close(); }
  });
}

test("une panne totale du moteur sans résultat restitue le quota et conserve l'ADN existant", async () => {
  const h = await harness({ providerFailure: true });
  try {
    const before = structuredClone(h.memory());
    await h.route.POST(new Request("https://app.example/api/ai-memory/analyze-channels?background=1", { method: "POST" }));
    h.release(); await h.afterCallbacks[0]();
    const status = await (await h.route.GET()).json();
    assert.equal(status.job.status, "failed");
    assert.equal(status.quota.used, 0);
    assert.deepEqual(h.memory(), before);
  } finally { await h.db.close(); }
});
